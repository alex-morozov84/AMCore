import { Injectable } from '@nestjs/common'

import {
  MEMBER_KEY_API_BYTES,
  type MemberKeyList,
  type MemberKeyQuery,
  serializedJsonBytes,
} from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'
import { apiKeyStatus, apiKeyStatusWhere } from '../../api-keys/api-key-lifecycle.js'

import type { MemberKeyActor } from './member-key-actor.js'
import { authorizeMemberKeys, lockKeyActor } from './member-key-authority.js'

@Injectable()
export class MemberKeyQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async list(
    orgId: string,
    userId: string,
    q: MemberKeyQuery,
    actor: MemberKeyActor
  ): Promise<MemberKeyList> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const role = await lockKeyActor(tx, actor)
          await authorizeMemberKeys(tx, orgId, actor, role)
          await this.preflightIdentity(tx, orgId, userId)
          const organization = await tx.organization.findUnique({
            where: { id: orgId },
            select: { id: true, name: true },
          })
          const member = await tx.orgMember.findUnique({
            where: { userId_organizationId: { userId, organizationId: orgId } },
            select: { id: true, user: { select: { name: true, email: true } } },
          })
          if (!organization || !member)
            throw new AppException('Member unavailable', 404, 'MEMBER_UNAVAILABLE')
          if (q.expectedMemberId !== member.id)
            throw new AppException('Member changed', 409, 'MEMBER_API_KEYS_CONFLICT')
          const now = new Date()
          const where = { organizationId: orgId, userId, ...apiKeyStatusWhere(q.status, now) }
          const page = {
            where,
            orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
          }
          const selected = await tx.apiKey.findMany({ ...page, select: { id: true } })
          await this.preflightKeys(
            tx,
            selected.map((r) => r.id)
          )
          const keys = await tx.apiKey.findMany({
            ...page,
            select: {
              id: true,
              name: true,
              scopes: true,
              createdAt: true,
              expiresAt: true,
              lastUsedAt: true,
              revokedAt: true,
              revocationReason: true,
            },
          })
          const total = await tx.apiKey.count({ where })
          const revocableCount = await tx.apiKey.count({
            where: { organizationId: orgId, userId, revokedAt: null },
          })
          const result: MemberKeyList = {
            organization,
            member: { memberId: member.id, userId, ...member.user },
            total,
            revocableCount,
            page: q.page,
            limit: q.limit,
            revokeAllLimit: 1000,
            asOf: now.toISOString(),
            data: keys.map((key) => ({
              ...key,
              status: apiKeyStatus(key, now),
              revocationReason:
                key.revocationReason as MemberKeyList['data'][number]['revocationReason'],
              createdAt: key.createdAt.toISOString(),
              expiresAt: key.expiresAt?.toISOString() ?? null,
              lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
              revokedAt: key.revokedAt?.toISOString() ?? null,
            })),
          }
          if (
            !Number.isSafeInteger(total) ||
            !Number.isSafeInteger(revocableCount) ||
            serializedJsonBytes(result) > MEMBER_KEY_API_BYTES
          )
            throw new Error('Read budget')
          return result
        },
        { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 8000 }
      )
    } catch (error) {
      if (error instanceof AppException) throw error
      throw new AppException('Key metadata unavailable', 503, 'MEMBER_API_KEYS_READ_UNAVAILABLE')
    }
  }
  private async preflightIdentity(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ bytes: number }>>`
      SELECT octet_length(jsonb_build_array(o.id, o.name, m.id, u.id, u.name, u.email)::text) AS bytes
      FROM core.org_members m JOIN core.users u ON u.id = m."userId"
      JOIN core.organizations o ON o.id = m."organizationId"
      WHERE o.id = ${orgId} AND u.id = ${userId}`
    if (rows.some((row) => row.bytes > 16384)) throw new Error('Identity budget')
  }
  private async preflightKeys(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    if (!ids.length) return
    const rows = await tx.$queryRaw<Array<{ bytes: number }>>(Prisma.sql`
      SELECT octet_length(jsonb_build_object('id',id,'name',name,'scopes',scopes,
        'createdAt',"createdAt",'expiresAt',"expiresAt",'lastUsedAt',"lastUsedAt",
        'revokedAt',"revokedAt",'revocationReason',"revocationReason",'status','unexpired')::text) AS bytes
      FROM core.api_keys WHERE id IN (${Prisma.join(ids)})`)
    if (rows.some((r) => r.bytes > 65536) || rows.reduce((sum, r) => sum + r.bytes, 0) > 196608)
      throw new Error('Page budget')
  }
}
