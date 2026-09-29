import { Injectable } from '@nestjs/common'

import type { AdminApiKeyRevokeResponse } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'

import { AuditActorType, AuditTargetType, Prisma } from '@/generated/prisma/client'

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

  private async transition(
    tx: Prisma.TransactionClient,
    rows: LockedKey[],
    actorId: string,
    reason: 'platform_revoked' | 'owner_revoked'
  ): Promise<number> {
    let count = 0
    const revokedAt = new Date()
    for (const row of rows) {
      const changed = await tx.apiKey.updateMany({
        where: { id: row.id, revokedAt: null },
        data: {
          revokedAt,
          revokedByUserId: actorId,
          revocationReason: reason,
          keyHash: null,
          salt: null,
        },
      })
      if (!changed.count) continue
      count += changed.count
      await this.audit.record(
        {
          action: 'api_key.revoked',
          actorId,
          actorType: AuditActorType.USER,
          organizationId: row.organizationId,
          targetId: row.id,
          targetType: AuditTargetType.API_KEY,
          metadata: { reason, pinoEvent: 'api_key.revoked' },
        },
        { tx }
      )
    }
    return count
  }
}
