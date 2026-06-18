import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { NotificationAttemptOutcome, NotificationDeliveryStatus, Prisma } from '@prisma/client'

import { PrismaService } from '../../../prisma'
import {
  NOTIFICATION_CLAIM_BATCH_LIMIT,
  NOTIFICATION_LEASE_TTL_MS,
  NOTIFICATION_REAP_BATCH_LIMIT,
  NotificationErrorCode,
  NotificationTerminalReason,
} from '../notification-dispatch.constants'

import { computeNextAttemptAt } from './notification-backoff'
import type { ClaimedDelivery, FinalizeResult, ReapResult } from './notification-dispatch.types'

/** Shape returned by the raw claim `UPDATE ... RETURNING`. */
interface ClaimedRow {
  id: string
  notificationId: string
  channel: string
  targetKey: string
  targetRef: string | null
  destinationSnapshot: Prisma.JsonValue | null
  locale: string
  attemptCount: number
  maxAttempts: number
}

/** Shape returned by the raw reaper `SELECT ... FOR UPDATE SKIP LOCKED`. */
interface ReapRow {
  id: string
  attemptCount: number
  maxAttempts: number
  // A PROCESSING row always carries a lease token (set at claim time).
  leaseToken: string
}

/** Fields written when finalizing an attempt row. */
interface AttemptFinalization {
  outcome: NotificationAttemptOutcome
  errorCode?: string
  providerMessageId?: string
  durationMs?: number
}

/**
 * Durable delivery state machine (ADR-052). Postgres owns claiming, leasing, the retry
 * schedule, and attempt history. The only raw SQL is the `FOR UPDATE SKIP LOCKED` claim
 * (Prisma has no high-level equivalent); every finalize/reap transition is an optimistic
 * CAS via `updateMany` keyed by `(id, leaseToken)`, so a stale lease holder can never
 * overwrite newer state. No provider I/O happens here — the dispatcher does that between
 * `claimDueBatch` and the finalize call.
 */
@Injectable()
export class NotificationDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically claim up to `limit` due deliveries: lease them (`PROCESSING`), bump
   * `attemptCount`, and insert one in-flight attempt row each — all in one short
   * transaction with no external I/O. Due = `PENDING`/`RETRY_SCHEDULED` whose
   * `availableAt`/`nextAttemptAt` have arrived. `SKIP LOCKED` lets every worker/replica
   * drain disjoint rows without blocking.
   */
  async claimDueBatch(limit: number = NOTIFICATION_CLAIM_BATCH_LIMIT): Promise<ClaimedDelivery[]> {
    const leaseToken = randomUUID()
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + NOTIFICATION_LEASE_TTL_MS)

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE "notifications"."notification_deliveries" AS d
        SET status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus",
            "leaseToken" = ${leaseToken},
            "leaseExpiresAt" = ${leaseExpiresAt},
            "attemptCount" = d."attemptCount" + 1,
            "updatedAt" = now()
        FROM (
          SELECT id FROM "notifications"."notification_deliveries"
          WHERE status IN (
              'PENDING'::"notifications"."NotificationDeliveryStatus",
              'RETRY_SCHEDULED'::"notifications"."NotificationDeliveryStatus"
            )
            AND "availableAt" <= now()
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
          ORDER BY COALESCE("nextAttemptAt", "availableAt")
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        ) AS sub
        WHERE d.id = sub.id
        RETURNING d.id, d."notificationId", d.channel, d."targetKey", d."targetRef",
                  d."destinationSnapshot", d.locale, d."attemptCount", d."maxAttempts"
      `)

      if (rows.length === 0) return []

      // Attempt ids are Prisma-generated cuids (the `@default(cuid())` is client-side, not
      // a DB default), so insert via the client rather than the raw statement above.
      await tx.notificationDeliveryAttempt.createMany({
        data: rows.map((row) => ({
          deliveryId: row.id,
          attemptNumber: row.attemptCount,
          leaseToken,
          startedAt: now,
        })),
      })

      return rows.map((row) => ({
        id: row.id,
        notificationId: row.notificationId,
        channel: row.channel,
        targetKey: row.targetKey,
        targetRef: row.targetRef,
        destinationSnapshot: row.destinationSnapshot,
        locale: row.locale,
        attemptNumber: row.attemptCount,
        maxAttempts: row.maxAttempts,
        leaseToken,
      }))
    })
  }

  /** Provider delivered: mark `DELIVERED` and close the attempt — atomically. */
  async finalizeDelivered(
    claim: ClaimedDelivery,
    providerMessageId: string | undefined,
    durationMs: number
  ): Promise<FinalizeResult> {
    const won = await this.finalizeInTx(
      claim,
      {
        status: NotificationDeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        providerMessageId: providerMessageId ?? null,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      { outcome: NotificationAttemptOutcome.DELIVERED, providerMessageId, durationMs }
    )
    return won ? { state: 'delivered' } : { state: 'lease_lost' }
  }

  /** Transient failure: reschedule with backoff if budget remains, else fail (exhausted). */
  async finalizeTransient(
    claim: ClaimedDelivery,
    errorCode: string,
    durationMs: number
  ): Promise<FinalizeResult> {
    const now = new Date()
    const attemptFinal: AttemptFinalization = {
      outcome: NotificationAttemptOutcome.TRANSIENT_FAILURE,
      errorCode,
      durationMs,
    }

    if (claim.attemptNumber >= claim.maxAttempts) {
      const won = await this.finalizeInTx(
        claim,
        {
          status: NotificationDeliveryStatus.FAILED,
          failedAt: now,
          lastErrorCode: errorCode,
          terminalReasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED,
          leaseToken: null,
          leaseExpiresAt: null,
        },
        attemptFinal
      )
      return won
        ? {
            state: 'failed',
            reasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED,
            deadLettered: true,
          }
        : { state: 'lease_lost' }
    }

    const nextAttemptAt = computeNextAttemptAt(claim.attemptNumber, now)
    const won = await this.finalizeInTx(
      claim,
      {
        status: NotificationDeliveryStatus.RETRY_SCHEDULED,
        nextAttemptAt,
        lastErrorCode: errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      attemptFinal
    )
    return won ? { state: 'retry_scheduled', nextAttemptAt } : { state: 'lease_lost' }
  }

  /** Permanent failure: terminal `FAILED`, never retried. */
  async finalizePermanent(
    claim: ClaimedDelivery,
    errorCode: string,
    durationMs: number
  ): Promise<FinalizeResult> {
    const won = await this.finalizeInTx(
      claim,
      {
        status: NotificationDeliveryStatus.FAILED,
        failedAt: new Date(),
        lastErrorCode: errorCode,
        terminalReasonCode: NotificationTerminalReason.PERMANENT_FAILURE,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      { outcome: NotificationAttemptOutcome.PERMANENT_FAILURE, errorCode, durationMs }
    )
    return won
      ? {
          state: 'failed',
          reasonCode: NotificationTerminalReason.PERMANENT_FAILURE,
          deadLettered: true,
        }
      : { state: 'lease_lost' }
  }

  /**
   * Reclaim deliveries whose `PROCESSING` lease expired (worker crashed/stalled). Locks
   * the expired rows with `FOR UPDATE SKIP LOCKED` so concurrent reapers and a healthy
   * worker's finalize CAS serialize on them, then — in the SAME transaction — transitions
   * the delivery (reschedule if budget remains, else fail) and closes the open attempt
   * `ABANDONED`. Holding the row lock first is what makes the delivery+attempt update
   * atomic and prevents a stale holder from corrupting attempt history.
   */
  async reapExpiredLeases(limit: number = NOTIFICATION_REAP_BATCH_LIMIT): Promise<ReapResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const expired = await tx.$queryRaw<ReapRow[]>(Prisma.sql`
        SELECT id, "attemptCount", "maxAttempts", "leaseToken"
        FROM "notifications"."notification_deliveries"
        WHERE status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
          AND "leaseExpiresAt" < now()
        ORDER BY "leaseExpiresAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)

      let rescheduled = 0
      let deadLettered = 0

      for (const delivery of expired) {
        const exhausted = delivery.attemptCount >= delivery.maxAttempts
        // We hold the row lock, so a plain id update is safe and final.
        await tx.notificationDelivery.update({
          where: { id: delivery.id },
          data: exhausted
            ? {
                status: NotificationDeliveryStatus.FAILED,
                failedAt: now,
                lastErrorCode: NotificationErrorCode.LEASE_EXPIRED,
                terminalReasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED,
                leaseToken: null,
                leaseExpiresAt: null,
              }
            : {
                status: NotificationDeliveryStatus.RETRY_SCHEDULED,
                nextAttemptAt: computeNextAttemptAt(delivery.attemptCount, now),
                lastErrorCode: NotificationErrorCode.LEASE_EXPIRED,
                leaseToken: null,
                leaseExpiresAt: null,
              },
        })

        // Close the in-flight attempt (only the open one — `outcome: null`).
        await tx.notificationDeliveryAttempt.updateMany({
          where: {
            deliveryId: delivery.id,
            attemptNumber: delivery.attemptCount,
            leaseToken: delivery.leaseToken,
            outcome: null,
          },
          data: {
            finishedAt: now,
            outcome: NotificationAttemptOutcome.ABANDONED,
            errorCode: NotificationErrorCode.LEASE_EXPIRED,
          },
        })

        if (exhausted) deadLettered += 1
        else rescheduled += 1
      }

      return { rescheduled, deadLettered }
    })
  }

  /**
   * Atomically finalize a claimed delivery: CAS the delivery on `(id, status=PROCESSING,
   * leaseToken)` and, only if we still own it, close the attempt — both in one
   * transaction so a crash can never leave a `DELIVERED` row with an `outcome: null`
   * attempt. Returns false (lease lost) if the CAS matched no row.
   */
  private async finalizeInTx(
    claim: ClaimedDelivery,
    deliveryData: Prisma.NotificationDeliveryUpdateManyMutationInput,
    finalization: AttemptFinalization
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notificationDelivery.updateMany({
        where: {
          id: claim.id,
          status: NotificationDeliveryStatus.PROCESSING,
          leaseToken: claim.leaseToken,
        },
        data: deliveryData,
      })
      if (count !== 1) return false

      await tx.notificationDeliveryAttempt.updateMany({
        where: {
          deliveryId: claim.id,
          attemptNumber: claim.attemptNumber,
          leaseToken: claim.leaseToken,
        },
        data: {
          finishedAt: new Date(),
          outcome: finalization.outcome,
          errorCode: finalization.errorCode ?? null,
          providerMessageId: finalization.providerMessageId ?? null,
          durationMs: finalization.durationMs ?? null,
        },
      })
      return true
    })
  }
}
