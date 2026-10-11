import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../prisma'
import {
  NOTIFICATION_CLAIM_BATCH_LIMIT,
  NOTIFICATION_LEASE_TTL_MS,
  NOTIFICATION_REAP_BATCH_LIMIT,
  NotificationErrorCode,
  NotificationTerminalReason,
} from '../notification-dispatch.constants'

import {
  applyRetryAfterFloor,
  computeNextAttemptAt,
  resolveRetryFloor,
} from './notification-backoff'
import { notificationClaimsAllowed } from './notification-claim-authority'
import type { ClaimedDelivery, FinalizeResult, ReapResult } from './notification-dispatch.types'
import {
  type NotificationEffectCertainty,
  settleNotificationEffect,
} from './notification-effect-evidence'
import { CUTOFF, type Cutoff, NotificationShutdownLatch } from './notification-shutdown.latch'

import {
  NotificationAttemptOutcome,
  NotificationDeliveryStatus,
  Prisma,
} from '@/generated/prisma/client'

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
  grantActorId: string | null
  grantCommandId: string | null
  grantAttemptNumber: number | null
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
  effectCertainty?: NotificationEffectCertainty
}

/**
 * Durable delivery state machine (ADR-052). Postgres owns claiming, leasing, the retry
 * schedule, and attempt history. Raw SQL is used only where Prisma has no high-level
 * equivalent — the `FOR UPDATE SKIP LOCKED` claim and the matching reaper lock; every
 * finalize/reap transition then CASes (or updates under the held row lock) keyed by
 * `(id, leaseToken)`, so a stale lease holder can never overwrite newer state, and the
 * delivery + attempt updates are always one transaction. No provider I/O happens here —
 * the dispatcher does that between `claimDueBatch` and the finalize call.
 *
 * Every transaction runs through the shutdown latch's guarded client: once sealed, the next
 * query throws, the transaction rolls back as a whole (a claim without its attempt, or a
 * terminal delivery with an open attempt, can never be committed) and the call returns
 * `CUTOFF` / `{ state: 'cutoff' }`. Lease expiry is computed by Postgres (`clock_timestamp()`),
 * never from this process's clock.
 */
@Injectable()
export class NotificationDeliveryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly latch: NotificationShutdownLatch
  ) {}

  /**
   * Atomically claim up to `limit` due deliveries: lease them (`PROCESSING`), bump
   * `attemptCount`, and insert one in-flight attempt row each — all in one short
   * transaction with no external I/O. Due = `PENDING`/`RETRY_SCHEDULED` whose
   * `availableAt`/`nextAttemptAt` have arrived. `SKIP LOCKED` lets every worker/replica
   * drain disjoint rows without blocking. The dispatcher claims ONE row per lane so a leased
   * row starts immediately instead of waiting behind a batch.
   *
   * `NotificationDeliveryBacklogCollector.collectDue()` mirrors this exact
   * predicate for the `amcore_notification_delivery_due` gauge — change one,
   * change the other, or the alertable count silently stops matching what
   * this claims.
   */
  async claimDueBatch(
    limit: number = NOTIFICATION_CLAIM_BATCH_LIMIT
  ): Promise<ClaimedDelivery[] | Cutoff> {
    const leaseToken = randomUUID()
    const leaseSeconds = NOTIFICATION_LEASE_TTL_MS / 1000

    return this.latch.transaction(this.prisma, async (tx) => {
      if (!(await notificationClaimsAllowed(tx))) return []
      const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE "notifications"."notification_deliveries" AS d
        SET status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus",
            "leaseToken" = ${leaseToken},
            "leaseExpiresAt" = clock_timestamp() + make_interval(secs => ${leaseSeconds}::double precision),
            "attemptCount" = d."attemptCount" + 1,
            "manualGrant" = CASE WHEN d."manualGrant" = 'reserved' THEN 'spent' ELSE d."manualGrant" END,
            "grantAttemptNumber" = CASE WHEN d."manualGrant" = 'reserved' THEN d."attemptCount" + 1 ELSE d."grantAttemptNumber" END,
            "controlRevision" = d."controlRevision" + 1,
            "terminalAt" = NULL, "retryableExhaustion" = false,
            "updatedAt" = now()
        FROM (
          SELECT id FROM "notifications"."notification_deliveries"
          WHERE status IN (
              'PENDING'::"notifications"."NotificationDeliveryStatus",
              'RETRY_SCHEDULED'::"notifications"."NotificationDeliveryStatus"
            )
            AND "attemptCount" < "maxAttempts" + CASE WHEN "manualGrant" IN ('reserved', 'spent') THEN 1 ELSE 0 END
            AND "availableAt" <= clock_timestamp()
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp())
          ORDER BY COALESCE("nextAttemptAt", "availableAt")
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        ) AS sub
        WHERE d.id = sub.id
        RETURNING d.id, d."notificationId", d.channel, d."targetKey", d."targetRef",
                  d."destinationSnapshot", d.locale, d."attemptCount", (d."maxAttempts" + CASE WHEN d."manualGrant" IN ('reserved', 'spent') THEN 1 ELSE 0 END) AS "maxAttempts",
                  d."grantActorId", d."grantCommandId", d."grantAttemptNumber"
      `)

      if (rows.length === 0) return []

      // Attempt ids are Prisma-generated cuids (the `@default(cuid())` is client-side, not
      // a DB default), so insert via the client rather than the raw statement above. The attempt's
      // `startedAt` is history (Prisma stamps it with the process clock); only the LEASE expiry
      // above is lease-validity state and therefore database-derived.
      await tx.notificationDeliveryAttempt.createMany({
        data: rows.map((row) => ({
          deliveryId: row.id,
          attemptNumber: row.attemptCount,
          leaseToken,
          ...(row.grantAttemptNumber === row.attemptCount
            ? {
                grantActorId: row.grantActorId,
                grantCommandId: row.grantCommandId,
              }
            : {}),
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
    return this.toResult(won, { state: 'delivered' })
  }

  /**
   * Transient failure: reschedule with backoff if budget remains, else fail (exhausted).
   * `retryAfterMs` is an optional provider-requested floor, normalized ONCE before branching
   * (`resolveRetryFloor`, clamped to the 24 h ADR-052 policy maximum): a retry is scheduled at
   * the later of the jittered backoff and the floor; an exhausted terminal row keeps the floor
   * in `nextAttemptAt` ("earliest permitted next attempt") so a future manual retry cannot
   * bypass a fresh provider restriction. A `FAILED` row is never claimed regardless of that date.
   */
  async finalizeTransient(
    claim: ClaimedDelivery,
    errorCode: string,
    durationMs: number,
    retryAfterMs?: number,
    effectCertainty: NotificationEffectCertainty = 'unknown'
  ): Promise<FinalizeResult> {
    const exhausted = claim.attemptNumber >= claim.maxAttempts
    let nextAttemptAt: Date | undefined
    const won = await this.finalizeInTx(
      claim,
      (now) => {
        nextAttemptAt = exhausted
          ? resolveRetryFloor(retryAfterMs, now)
          : applyRetryAfterFloor(computeNextAttemptAt(claim.attemptNumber, now), retryAfterMs, now)
        return {
          status: exhausted
            ? NotificationDeliveryStatus.FAILED
            : NotificationDeliveryStatus.RETRY_SCHEDULED,
          ...(exhausted
            ? { failedAt: now, terminalReasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED }
            : {}),
          retryableExhaustion: exhausted,
          lastErrorCode: errorCode,
          nextAttemptAt: nextAttemptAt ?? null,
          leaseToken: null,
          leaseExpiresAt: null,
        }
      },
      {
        outcome: NotificationAttemptOutcome.TRANSIENT_FAILURE,
        effectCertainty,
        errorCode,
        durationMs,
      }
    )
    return this.toResult(
      won,
      exhausted
        ? {
            state: 'failed',
            reasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED,
            deadLettered: true,
          }
        : { state: 'retry_scheduled', nextAttemptAt: nextAttemptAt! }
    )
  }

  /** Permanent failure: terminal `FAILED`, never retried. */
  async finalizePermanent(
    claim: ClaimedDelivery,
    errorCode: string,
    durationMs: number,
    effectCertainty: NotificationEffectCertainty = 'unknown'
  ): Promise<FinalizeResult> {
    const won = await this.finalizeInTx(
      claim,
      {
        status: NotificationDeliveryStatus.FAILED,
        failedAt: new Date(),
        lastErrorCode: errorCode,
        terminalReasonCode: NotificationTerminalReason.PERMANENT_FAILURE,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      {
        outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
        errorCode,
        durationMs,
        effectCertainty,
      }
    )
    return this.toResult(won, {
      state: 'failed',
      reasonCode: NotificationTerminalReason.PERMANENT_FAILURE,
      deadLettered: true,
    })
  }

  /**
   * Reclaim deliveries whose `PROCESSING` lease expired (worker crashed/stalled). Locks
   * the expired rows with `FOR UPDATE SKIP LOCKED` so concurrent reapers and a healthy
   * worker's finalize CAS serialize on them, then — in the SAME transaction — transitions
   * the delivery (reschedule if budget remains, else fail) and closes the open attempt
   * `ABANDONED`. Holding the row lock first is what makes the delivery+attempt update
   * atomic and prevents a stale holder from corrupting attempt history. The whole pass is one
   * transaction: a shutdown seal mid-pass rolls the pass back and the next one redoes it.
   */
  async reapExpiredLeases(
    limit: number = NOTIFICATION_REAP_BATCH_LIMIT
  ): Promise<ReapResult | Cutoff> {
    return this.latch.transaction(this.prisma, async (tx) => {
      const expired = await tx.$queryRaw<ReapRow[]>(Prisma.sql`
        SELECT id, "attemptCount", ("maxAttempts" + CASE WHEN "manualGrant" IN ('reserved', 'spent') THEN 1 ELSE 0 END) AS "maxAttempts", "leaseToken"
        FROM "notifications"."notification_deliveries"
        WHERE status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
          AND "leaseExpiresAt" < clock_timestamp()
        ORDER BY "leaseExpiresAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)

      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      const now = clock!.now
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
                terminalAt: now,
                retryableExhaustion: false,
                controlRevision: { increment: 1 },
                lastErrorCode: NotificationErrorCode.LEASE_EXPIRED,
                terminalReasonCode: NotificationTerminalReason.ATTEMPTS_EXHAUSTED,
                nextAttemptAt: null,
                leaseToken: null,
                leaseExpiresAt: null,
              }
            : {
                status: NotificationDeliveryStatus.RETRY_SCHEDULED,
                nextAttemptAt: computeNextAttemptAt(delivery.attemptCount, now),
                controlRevision: { increment: 1 },
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
   * transaction so a crash (or a shutdown seal between the two writes) can never leave a
   * `DELIVERED` row with an `outcome: null` attempt. `lost` = the CAS matched no row.
   */
  private async finalizeInTx(
    claim: ClaimedDelivery,
    input:
      | Prisma.NotificationDeliveryUpdateManyMutationInput
      | ((now: Date) => Prisma.NotificationDeliveryUpdateManyMutationInput),
    finalization: AttemptFinalization
  ): Promise<'won' | 'lost' | Cutoff> {
    return this.latch.transaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', '500ms', true)`
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM notifications.notification_deliveries
        WHERE id = ${claim.id} AND status = 'PROCESSING' AND "leaseToken" = ${claim.leaseToken}
        FOR UPDATE`)
      if (locked.length !== 1) return 'lost' as const
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      const now = clock!.now
      const deliveryData = typeof input === 'function' ? input(now) : input
      const { count } = await tx.notificationDelivery.updateMany({
        where: {
          id: claim.id,
          status: NotificationDeliveryStatus.PROCESSING,
          leaseToken: claim.leaseToken,
        },
        data: {
          ...deliveryData,
          ...(deliveryData.deliveredAt ? { deliveredAt: now } : {}),
          ...(deliveryData.failedAt ? { failedAt: now } : {}),
          controlRevision: { increment: 1 },
          terminalAt: ['DELIVERED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(
            String(deliveryData.status)
          )
            ? now
            : null,
        },
      })
      if (count !== 1) return 'lost' as const
      await settleNotificationEffect(
        tx,
        claim.id,
        claim.leaseToken,
        finalization.outcome === NotificationAttemptOutcome.DELIVERED
          ? 'accepted'
          : (finalization.effectCertainty ?? 'unknown')
      )

      await tx.notificationDeliveryAttempt.updateMany({
        where: {
          deliveryId: claim.id,
          attemptNumber: claim.attemptNumber,
          leaseToken: claim.leaseToken,
        },
        data: {
          finishedAt: now,
          outcome: finalization.outcome,
          errorCode: finalization.errorCode ?? null,
          providerMessageId: finalization.providerMessageId ?? null,
          durationMs: finalization.durationMs ?? null,
        },
      })
      return 'won' as const
    })
  }

  private toResult(outcome: 'won' | 'lost' | Cutoff, won: FinalizeResult): FinalizeResult {
    if (outcome === CUTOFF) return { state: 'cutoff' }
    return outcome === 'won' ? won : { state: 'lease_lost' }
  }
}
