import { Injectable } from '@nestjs/common'

import {
  escapeLikeLiteral,
  MEMBER_API_RESPONSE_BYTES,
  MEMBER_ASSIGNED_BYTES,
  MEMBER_MAX_ROLES,
  type MemberRolesQuery,
  type MemberRolesResponse,
  type OrganizationMembersQuery,
  type OrganizationMembersResponse,
  serializedJsonBytes,
} from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { assignableRolesWhere } from './role-assignability-policy'

import type { Prisma } from '@/generated/prisma/client'

const summary = { id: true, name: true, description: true, isSystem: true } as const
const user = { id: true, name: true, email: true } as const
const order = [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }] as const

@Injectable()
export class MemberQueryService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    orgId: string,
    actorOrg: string | undefined,
    q: OrganizationMembersQuery
  ): Promise<OrganizationMembersResponse> {
    this.assertContext(orgId, actorOrg)
    return this.prisma.$transaction(
      async (tx) => {
        const org = await this.org(tx, orgId)
        const contains = q.search ? escapeLikeLiteral(q.search) : undefined
        const where: Prisma.OrgMemberWhereInput = {
          organizationId: orgId,
          ...(contains && {
            user: {
              OR: [
                { name: { contains, mode: 'insensitive' } },
                { email: { contains, mode: 'insensitive' } },
              ],
            },
          }),
        }
        const total = await tx.orgMember.count({ where })
        const rows = await tx.orgMember.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            createdAt: true,
            user: { select: user },
            _count: { select: { roles: true } },
            roles: {
              take: 10,
              orderBy: order.map((role) => ({ role })),
              select: { role: { select: summary } },
            },
          },
        })
        return this.budget({
          data: rows.map((r) => ({
            memberId: r.id,
            user: r.user,
            joinedAt: r.createdAt.toISOString(),
            rolesPreview: r.roles.map((x) => x.role),
            assignedRoleCount: r._count.roles,
          })),
          total,
          page: q.page,
          limit: q.limit,
          aclVersion: org.aclVersion,
        })
      },
      { isolationLevel: 'RepeatableRead' }
    )
  }

  roles(
    orgId: string,
    userId: string,
    actorOrg: string | undefined,
    q: MemberRolesQuery
  ): Promise<MemberRolesResponse> {
    this.assertContext(orgId, actorOrg)
    return this.prisma.$transaction(
      async (tx) => {
        const org = await this.org(tx, orgId)
        const member = await tx.orgMember.findUnique({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          select: { id: true, user: { select: user } },
        })
        if (!member) throw new AppException('Member unavailable', 404, 'MEMBER_UNAVAILABLE')
        const count = await tx.memberRole.count({ where: { memberId: member.id } })
        const assignedRoles =
          count <= MEMBER_MAX_ROLES
            ? (
                await tx.memberRole.findMany({
                  where: { memberId: member.id },
                  select: { role: { select: summary } },
                  orderBy: order.map((role) => ({ role })),
                })
              ).map((x) => x.role)
            : null
        const where: Prisma.RoleWhereInput = {
          ...assignableRolesWhere(orgId),
          ...(q.search && { name: { contains: escapeLikeLiteral(q.search), mode: 'insensitive' } }),
          ...(q.section === 'assigned' && { members: { some: { memberId: member.id } } }),
        }
        const total = await tx.role.count({ where })
        const data = await tx.role.findMany({
          where,
          select: summary,
          orderBy: [...order],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        })
        const base = {
          member: { memberId: member.id, user: member.user },
          aclVersion: org.aclVersion,
          assignedRoleCount: count,
          choices: { data, total, page: q.page, limit: q.limit },
        }
        const editable = {
          ...base,
          editMode: 'editable' as const,
          assignedRoles: assignedRoles ?? [],
        }
        if (
          assignedRoles &&
          serializedJsonBytes(assignedRoles) <= MEMBER_ASSIGNED_BYTES &&
          serializedJsonBytes(editable) <= MEMBER_API_RESPONSE_BYTES
        )
          return editable
        return this.budget({
          ...base,
          editMode: count > MEMBER_MAX_ROLES ? ('oversized' as const) : ('byteOversized' as const),
          assignedRoles: null,
        })
      },
      { isolationLevel: 'RepeatableRead' }
    )
  }

  private assertContext(orgId: string, actorOrg: string | undefined): void {
    if (orgId !== actorOrg) throw new ForbiddenException()
  }
  private async org(tx: Prisma.TransactionClient, orgId: string): Promise<{ aclVersion: number }> {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { aclVersion: true },
    })
    if (!org) throw new AppException('Organization unavailable', 404, 'MEMBER_UNAVAILABLE')
    return org
  }
  private budget<T>(value: T): T {
    if (serializedJsonBytes(value) > MEMBER_API_RESPONSE_BYTES)
      throw new AppException('Member read exceeds budget', 503, 'MEMBER_READ_UNAVAILABLE')
    return value
  }
}
