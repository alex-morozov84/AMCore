import { Injectable } from '@nestjs/common'

import type { AdminApiKeyRevokeResponse } from '@amcore/shared'

import { AppException, NotFoundException } from '../../common/exceptions/index.js'
import { AuditActorType, AuditTargetType, Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import { AuditLogService } from '../audit/index.js'

interface LockedKey {
  id: string
  organizationId: string
  revokedAt: Date | null
}

/** One irreversible state transition shared by personal and platform entrypoints. */
@Injectable()
export class ApiKeyRevocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  async revoke(
    ids: string[],
    actorId: string,
    platform: boolean,
    tx?: Prisma.TransactionClient
  ): Promise<AdminApiKeyRevokeResponse> {
    if (tx) {
      const [state] = await tx.$queryRaw<
        Array<{ transaction_isolation: string }>
      >`SHOW transaction_isolation`
      if (state?.transaction_isolation !== 'read committed')
        throw new Error('Revocation requires READ COMMITTED')
      return this.revokeInTransaction(tx, ids, actorId, platform)
    }
    return this.prisma.$transaction(
      (transaction) => this.revokeInTransaction(transaction, ids, actorId, platform),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    )
  }

  private async revokeInTransaction(
    tx: Prisma.TransactionClient,
    ids: string[],
    actorId: string,
    platform: boolean
  ): Promise<AdminApiKeyRevokeResponse> {
    const rows = await tx.$queryRaw<LockedKey[]>(Prisma.sql`
      SELECT id, "organizationId", "revokedAt" FROM core.api_keys
      WHERE id IN (${Prisma.join([...ids].sort())})
        ${platform ? Prisma.empty : Prisma.sql`AND "userId" = ${actorId}`}
      ORDER BY id FOR UPDATE
    `)
    if (rows.length !== ids.length) throw new NotFoundException('API key')
    const reason = platform ? 'platform_revoked' : 'owner_revoked'
    const affectedCount = await this.transition(tx, rows, actorId, reason)
    if (platform)
      await this.audit.record(
        {
          action: 'admin.api_keys.revocation_requested',
          actorId,
          actorType: AuditActorType.USER,
          metadata: { requestedCount: ids.length, affectedCount, reason },
        },
        { tx }
      )
    return { requestedCount: ids.length, affectedCount }
  }

  async revokeMember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    actorId: string,
    reason: 'organization_admin_revoked' | 'membership_removed',
    keyId?: string
  ): Promise<{ requestedCount: number; affectedCount: number }> {
    const [state] = await tx.$queryRaw<
      Array<{ transaction_isolation: string }>
    >`SHOW transaction_isolation`
    if (state?.transaction_isolation !== 'read committed')
      throw new Error('Revocation requires READ COMMITTED')
    const rows = await tx.apiKey.findMany({
      where: { organizationId, userId, ...(keyId ? { id: keyId } : { revokedAt: null }) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: keyId ? 1 : 1001,
    })
    if (keyId && !rows.length)
      throw new AppException('Key unavailable', 404, 'MEMBER_API_KEY_UNAVAILABLE')
    if (rows.length > 1000) throw new AppException('Too many keys', 409, 'MEMBER_API_KEYS_LIMIT')
    if (!rows.length) return { requestedCount: 0, affectedCount: 0 }
    const locked = await tx.$queryRaw<LockedKey[]>(Prisma.sql`
      SELECT id, "organizationId", "revokedAt" FROM core.api_keys
      WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
      AND id IN (${Prisma.join(rows.map((r) => r.id))}) ORDER BY id FOR UPDATE`)
    if (keyId && !locked.length)
      throw new AppException('Key unavailable', 404, 'MEMBER_API_KEY_UNAVAILABLE')
    return {
      requestedCount: rows.length,
      affectedCount: await this.transition(tx, locked, actorId, reason),
    }
  }

  private async transition(
    tx: Prisma.TransactionClient,
    rows: LockedKey[],
    actorId: string,
    reason:
      'platform_revoked' | 'owner_revoked' | 'organization_admin_revoked' | 'membership_removed'
  ): Promise<number> {
    if (!rows.length) return 0
    const changed = await tx.$queryRaw<Array<{ id: string; organizationId: string }>>(Prisma.sql`
      UPDATE core.api_keys SET "revokedAt" = ${new Date()}, "revokedByUserId" = ${actorId},
        "revocationReason" = ${reason}, "keyHash" = NULL, salt = NULL
      WHERE id IN (${Prisma.join(rows.map((row) => row.id))}) AND "revokedAt" IS NULL
      RETURNING id, "organizationId"`)
    await this.audit.recordMany(
      changed.map((row) => ({
        action: 'api_key.revoked',
        actorId,
        actorType: AuditActorType.USER,
        organizationId: row.organizationId,
        targetId: row.id,
        targetType: AuditTargetType.API_KEY,
        metadata: { reason, pinoEvent: 'api_key.revoked' },
      })),
      tx
    )
    return changed.length
  }
}
