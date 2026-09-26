import { Injectable } from '@nestjs/common'

import {
  type AdminOrganizationDetailQuery,
  type AdminOrganizationDetailResponse,
  type AdminUserDetailQuery,
  type AdminUserDetailResponse,
  escapeLikeLiteral,
} from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import {
  DETAIL_ORGANIZATION_SELECT,
  DETAIL_USER_SELECT,
  ORGANIZATION_MEMBER_SELECT,
  projectDetailOrganization,
  projectDetailUser,
  projectRoles,
  USER_MEMBERSHIP_SELECT,
} from './admin-detail-projection'

import { Prisma } from '@/generated/prisma/client'

@Injectable()
export class AdminDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async user(
    id: string,
    { page, limit, search }: AdminUserDetailQuery
  ): Promise<AdminUserDetailResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: DETAIL_USER_SELECT })
        if (!user) throw new NotFoundException('User', id)
        const literal = search ? escapeLikeLiteral(search) : undefined
        const where: Prisma.OrgMemberWhereInput = {
          userId: id,
          ...(literal
            ? {
                organization: {
                  OR: [
                    { name: { contains: literal, mode: 'insensitive' } },
                    { slug: { contains: literal, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        }
        const membershipCount = await tx.orgMember.count({ where: { userId: id } })
        const total = search ? await tx.orgMember.count({ where }) : membershipCount
        const rows = await tx.orgMember.findMany({
          where,
          select: USER_MEMBERSHIP_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        })
        return {
          user: projectDetailUser(user),
          membershipCount,
          memberships: {
            data: rows.map((row) => ({
              organization: row.organization,
              roles: projectRoles(row.roles),
              joinedAt: row.createdAt.toISOString(),
            })),
            total,
            page,
            limit,
          },
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
  }

  async organization(
    id: string,
    { page, limit, search }: AdminOrganizationDetailQuery
  ): Promise<AdminOrganizationDetailResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id },
          select: DETAIL_ORGANIZATION_SELECT,
        })
        if (!organization) throw new NotFoundException('Organization', id)
        const literal = search ? escapeLikeLiteral(search) : undefined
        const where: Prisma.OrgMemberWhereInput = {
          organizationId: id,
          ...(literal
            ? {
                user: {
                  OR: [
                    { name: { contains: literal, mode: 'insensitive' } },
                    { email: { contains: literal, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        }
        const memberCount = await tx.orgMember.count({ where: { organizationId: id } })
        const total = search ? await tx.orgMember.count({ where }) : memberCount
        const rows = await tx.orgMember.findMany({
          where,
          select: ORGANIZATION_MEMBER_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        })
        return {
          organization: projectDetailOrganization(organization),
          memberCount,
          members: {
            data: rows.map((row) => ({
              user: row.user,
              roles: projectRoles(row.roles),
              joinedAt: row.createdAt.toISOString(),
            })),
            total,
            page,
            limit,
          },
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
  }
}
