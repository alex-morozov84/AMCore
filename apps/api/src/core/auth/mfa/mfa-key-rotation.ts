import { z } from 'zod'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { PrismaClient } from '../../../generated/prisma/client.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { lockMfaAccounts } from './mfa-transaction.js'

export interface MfaKeyRotationBatch {
  examined: number
  rotated: number
  skipped: number
  failed: number
  nextUserId: string | null
  remaining: boolean
}

/** DB-only administrative primitive. Independent account transactions; a failed batch is not rollback of earlier accounts. */
export class MfaKeyRotation {
  constructor(
    private readonly db: PrismaClient,
    private readonly encryption: MfaEncryptionService
  ) {}

  async batch(afterUserId?: string): Promise<MfaKeyRotationBatch> {
    if (afterUserId !== undefined) z.string().min(1).max(128).parse(afterUserId)
    const active = this.encryption.activeKeyId()
    const candidates = await this.db.mfaFactor.findMany({
      where: { keyId: { not: active }, ...(afterUserId && { userId: { gt: afterUserId } }) },
      orderBy: { userId: 'asc' },
      take: 100,
      select: { id: true, userId: true },
    })
    const result: MfaKeyRotationBatch = {
      examined: candidates.length,
      rotated: 0,
      skipped: 0,
      failed: 0,
      nextUserId: null,
      remaining: false,
    }
    for (const candidate of candidates) {
      try {
        const rotated = await this.rotate(candidate, active)
        result[rotated ? 'rotated' : 'skipped'] += 1
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error
        result.failed += 1
      }
    }
    const last = candidates.at(-1)?.userId
    if (
      last &&
      (await this.db.mfaFactor.findFirst({
        where: { keyId: { not: active }, userId: { gt: last } },
        select: { id: true },
      }))
    )
      result.nextUserId = last
    result.remaining = !!(await this.db.mfaFactor.findFirst({
      where: { keyId: { not: active } },
      select: { id: true },
    }))
    return result
  }

  private async rotate(
    candidate: { id: string; userId: string },
    active: string
  ): Promise<boolean> {
    return this.db.$transaction(
      async (tx) => {
        await lockMfaAccounts(tx, [candidate.userId])
        const [current] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM core.mfa_factors WHERE id = ${candidate.id} AND "userId" = ${candidate.userId} FOR UPDATE`
        if (!current) return false
        const factor = await tx.mfaFactor.findUniqueOrThrow({ where: { id: current.id } })
        if (factor.keyId === active) return false
        const seed = this.encryption.decrypt(
          factor.userId,
          factor.id,
          factor.keyId,
          factor.encryptedSeed
        )
        const encrypted = this.encryption.encrypt(factor.userId, factor.id, seed)
        if (encrypted.keyId !== active)
          throw new ServiceUnavailableException('MFA write key changed')
        await tx.mfaFactor.update({ where: { id: factor.id }, data: encrypted })
        return true
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
