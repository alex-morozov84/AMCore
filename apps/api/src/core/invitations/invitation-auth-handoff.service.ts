import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { equalHandoffKey, type InvitationHandoffProof } from './invitation-auth-handoff'
import { invitationClock } from './invitation-locks'

import type { InvitationAuthHandoff, Prisma } from '@/generated/prisma/client'

@Injectable()
export class InvitationAuthHandoffService {
  constructor(private readonly prisma: PrismaService) {}

  settle(
    proof: InvitationHandoffProof,
    kind: 'confirm',
    actor: RequestPrincipal
  ): Promise<{ status: 'confirmed' }>
  settle(proof: InvitationHandoffProof, kind: 'abort'): Promise<{ status: 'aborted' }>
  async settle(
    proof: InvitationHandoffProof,
    kind: 'confirm' | 'abort',
    actor?: RequestPrincipal
  ): Promise<{ status: 'confirmed' | 'aborted' }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
        const row = await this.lock(tx, proof.attemptId)
        if (!row || !equalHandoffKey(row.cleanupKeyHash, proof.cleanupKeyHash)) throw this.invalid()
        const [session] = await tx.$queryRaw<
          { userId: string; expiresAt: Date; revokedAt: Date | null }[]
        >`
        SELECT "userId", "expiresAt", "revokedAt" FROM core.sessions WHERE id = ${row.sessionId} FOR UPDATE`
        const now = await invitationClock(tx)
        if (kind === 'abort') {
          if (row.status === 'confirmed')
            throw new AppException(
              'Handoff already confirmed',
              409,
              AuthErrorCode.AUTH_HANDOFF_CONFIRMED
            )
          await this.abortLocked(tx, row, now)
          return { status: 'aborted' }
        }
        if (
          !actor ||
          actor.type !== 'jwt' ||
          actor.sid !== row.sessionId ||
          actor.sub !== row.actorId ||
          !session ||
          session.userId !== actor.sub ||
          session.revokedAt ||
          session.expiresAt <= now
        )
          throw this.invalid()
        if (row.status === 'confirmed') return { status: 'confirmed' }
        if (row.status !== 'pending' || row.deadline <= now)
          throw new AppException(
            'Authentication handoff expired',
            401,
            AuthErrorCode.AUTH_HANDOFF_INVALID
          )
        await tx.invitationAuthHandoff.update({
          where: { attemptId: row.attemptId },
          data: { status: 'confirmed', settledAt: now },
        })
        return { status: 'confirmed' }
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }

  /** DB-only safety net runs on worker/all; Redis publication is never required. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const expired = await this.prisma.$queryRaw<{ attemptId: string }[]>`
      SELECT "attemptId" FROM core.invitation_auth_handoffs
      WHERE status = 'pending' AND deadline <= clock_timestamp() AT TIME ZONE 'UTC'
      ORDER BY deadline LIMIT 100`
    for (const { attemptId } of expired) {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
          const row = await this.lock(tx, attemptId)
          const now = await invitationClock(tx)
          if (!row || row.status !== 'pending' || row.deadline > now) return
          await tx.$queryRaw`SELECT id FROM core.sessions WHERE id = ${row.sessionId} FOR UPDATE`
          await this.abortLocked(tx, row, now)
        },
        { maxWait: 2000, timeout: 4000 }
      )
    }
  }

  private async abortLocked(
    tx: Prisma.TransactionClient,
    row: InvitationAuthHandoff,
    now: Date
  ): Promise<void> {
    await tx.session.updateMany({
      where: { id: row.sessionId, revokedAt: null },
      data: {
        revokedAt: now,
        revocationReason: 'invitation-handoff-aborted',
      },
    })
    if (row.status === 'pending')
      await tx.invitationAuthHandoff.update({
        where: { attemptId: row.attemptId },
        data: { status: 'aborted', settledAt: now },
      })
  }
  private async lock(
    tx: Prisma.TransactionClient,
    attempt: string
  ): Promise<InvitationAuthHandoff | undefined> {
    const [row] = await tx.$queryRaw<InvitationAuthHandoff[]>`
      SELECT * FROM core.invitation_auth_handoffs WHERE "attemptId" = ${attempt} FOR UPDATE`
    return row
  }
  private invalid(): AppException {
    return new AppException(
      'Invalid authentication handoff proof',
      401,
      AuthErrorCode.AUTH_HANDOFF_INVALID
    )
  }
}
