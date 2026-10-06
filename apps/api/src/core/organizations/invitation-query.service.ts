import { Injectable } from '@nestjs/common'

import {
  escapeLikeLiteral,
  type InviteListQuery,
  type InviteListResponse,
  type InviteRoleChoicesQuery,
  type InviteRoleChoicesResponse,
  type ManagerInviteOperationResponse,
  managerInviteOperationResponseSchema,
  serializedJsonBytes,
} from '@amcore/shared'

import { ServiceUnavailableException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { invitationDefaultRole } from '../invitations/invitation-role-intent'

import type { InvitationActor } from './invitation-actor'
import { InvitationAuthorization } from './invitation-authorization'
import { invitationClock } from './invitation-locks'
import { INVITATION_RETENTION_MS, parseInvitationOperationId } from './invitation-operation'
import { invitationFailure } from './invitation-transaction'
import { assignableRolesWhere, isRoleAssignable } from './role-assignability-policy'

import type { Prisma } from '@/generated/prisma/client'

const roleProjection = { id: true, name: true, description: true, isSystem: true } as const
@Injectable()
export class InvitationQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: InvitationAuthorization
  ) {}

  list(orgId: string, actor: InvitationActor, q: InviteListQuery): Promise<InviteListResponse> {
    return this.read(orgId, actor, async (tx) => {
      const now = await invitationClock(tx)
      const where: Prisma.OrgInviteWhereInput = {
        organizationId: orgId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt:
          q.status === 'pending'
            ? { gt: now }
            : q.status === 'expired'
              ? { lte: now, gt: new Date(now.getTime() - INVITATION_RETENTION_MS) }
              : { gt: new Date(now.getTime() - INVITATION_RETENTION_MS) },
        ...(q.search
          ? { emailCanonical: { contains: escapeLikeLiteral(q.search.toLowerCase()) } }
          : {}),
      }
      const total = await tx.orgInvite.count({ where })
      const rows = await tx.orgInvite.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          email: true,
          generation: true,
          issuedAt: true,
          issuedAtEstimated: true,
          expiresAt: true,
          intentInvalid: true,
          roleIntents: {
            orderBy: { ordinal: 'asc' },
            select: {
              requestedRoleId: true,
              liveRoleId: true,
              roleNameAtIssue: true,
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  isSystem: true,
                  organizationId: true,
                },
              },
            },
          },
        },
      })
      return this.budget({
        data: rows.map((row) => ({
          id: row.id,
          email: row.email,
          generation: row.generation,
          issuedAt: row.issuedAt.toISOString(),
          issuedAtEstimated: row.issuedAtEstimated,
          expiresAt: row.expiresAt.toISOString(),
          status: row.expiresAt > now ? ('pending' as const) : ('expired' as const),
          intentValid:
            !row.intentInvalid &&
            row.roleIntents.length > 0 &&
            row.roleIntents.length <= 20 &&
            row.roleIntents.every(
              (r) => r.role && r.liveRoleId === r.requestedRoleId && isRoleAssignable(r.role, orgId)
            ),
          roles: row.roleIntents.map((r) => ({
            requestedRoleId: r.requestedRoleId,
            id: r.liveRoleId,
            nameAtIssue: r.roleNameAtIssue,
            name: r.role?.name ?? null,
            description: r.role?.description ?? null,
          })),
        })),
        total,
        page: q.page,
        limit: q.limit,
      })
    })
  }

  choices(
    orgId: string,
    actor: InvitationActor,
    q: InviteRoleChoicesQuery
  ): Promise<InviteRoleChoicesResponse> {
    return this.read(orgId, actor, async (tx) => {
      const assignable: Prisma.RoleWhereInput = assignableRolesWhere(orgId)
      const defaultRole = await invitationDefaultRole(tx)
      const where = {
        ...assignable,
        ...(q.search
          ? { name: { contains: escapeLikeLiteral(q.search), mode: 'insensitive' as const } }
          : {}),
      }
      const total = await tx.role.count({ where })
      const data = await tx.role.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        select: roleProjection,
      })
      return this.budget({ data, total, page: q.page, limit: q.limit, defaultRole })
    })
  }

  operation(
    orgId: string,
    actor: InvitationActor,
    id: string
  ): Promise<ManagerInviteOperationResponse> {
    parseInvitationOperationId(id)
    return this.read(orgId, actor, async (tx) => {
      const row = await tx.invitationOperation.findUnique({
        where: {
          actorId_scope_operationId: {
            actorId: actor.principal.sub,
            scope: orgId,
            operationId: id,
          },
        },
      })
      const now = await invitationClock(tx)
      if (!row || now.getTime() - row.completedAt.getTime() >= INVITATION_RETENTION_MS)
        return { state: 'unknown' }
      return managerInviteOperationResponseSchema.parse({
        state: 'committed',
        kind: row.kind,
        result: row.result,
      })
    })
  }

  private async read<T>(
    orgId: string,
    actor: InvitationActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
          const user = await this.authorization.lockActor(tx, actor)
          await this.authorization.authorize(tx, orgId, actor, user)
          return work(tx)
        },
        { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      return invitationFailure(error)
    }
  }

  private budget<T>(response: T): T {
    if (serializedJsonBytes(response) > 262_144)
      throw new ServiceUnavailableException('Invitation response budget exceeded')
    return response
  }
}
