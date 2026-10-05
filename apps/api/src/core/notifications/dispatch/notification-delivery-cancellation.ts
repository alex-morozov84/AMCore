import { NotificationErrorCode } from '../notification-dispatch.constants'

import type { ClaimedDelivery } from './notification-dispatch.types'

import { NotificationAttemptOutcome, Prisma } from '@/generated/prisma/client'

/** Which still-active deliveries of one durable target to cancel. */
export interface CancelActiveTarget {
  channel: string
  /** The durable connection/subscription aggregate id (`NotificationDelivery.targetRef`). */
  targetRef: string
  /** Bounded terminal reason (`terminalReasonCode`). */
  reason: string
  /** Leave this delivery untouched — e.g. the delivery whose own permanent failure triggered a fence. */
  exceptDeliveryId?: string
}

/**
 * Cancel every non-terminal delivery of a revoked/blocked target — `PENDING`,
 * `RETRY_SCHEDULED` **and `PROCESSING`** — and close the open attempts of the cancelled rows
 * `ABANDONED`/`delivery_cancelled`, atomically in the caller's transaction. Cancelling a
 * `PROCESSING` row clears its lease, so the in-flight holder's later finalize loses its
 * `(id, status=PROCESSING, leaseToken)` CAS: it can neither resurrect the row through a
 * transient/reaper path nor overwrite it. A send that was already started may still complete
 * (ADR-052 at-least-once); only NEW sends and resurrection are prevented.
 *
 * Transaction-agnostic (web-role unlink/bind pass a plain client, the worker passes a guarded
 * one). It never swallows errors: a `ShutdownCutoffError` from a guarded client must reach the
 * transaction boundary so the whole transaction rolls back. Lock order: callers hold the
 * connection row lock first; this only touches delivery and attempt rows.
 */
export async function cancelActiveDeliveries(
  tx: Prisma.TransactionClient,
  target: CancelActiveTarget
): Promise<number> {
  const exclusion = target.exceptDeliveryId
    ? Prisma.sql`AND id <> ${target.exceptDeliveryId}`
    : Prisma.empty
  const cancelled = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "notifications"."notification_deliveries"
    SET status = 'CANCELLED'::"notifications"."NotificationDeliveryStatus",
        "terminalReasonCode" = ${target.reason},
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "nextAttemptAt" = NULL,
        "updatedAt" = now()
    WHERE channel = ${target.channel}
      AND "targetRef" = ${target.targetRef}
      AND status IN (
        'PENDING'::"notifications"."NotificationDeliveryStatus",
        'RETRY_SCHEDULED'::"notifications"."NotificationDeliveryStatus",
        'PROCESSING'::"notifications"."NotificationDeliveryStatus"
      )
      ${exclusion}
    RETURNING id
  `)
  if (cancelled.length === 0) return 0

  await tx.notificationDeliveryAttempt.updateMany({
    where: { deliveryId: { in: cancelled.map((row) => row.id) }, outcome: null },
    data: {
      finishedAt: new Date(),
      outcome: NotificationAttemptOutcome.ABANDONED,
      errorCode: NotificationErrorCode.DELIVERY_CANCELLED,
    },
  })
  return cancelled.length
}

/**
 * Cancel ONE claimed delivery by its lease (actual-start admission found its target revoked),
 * closing its open attempt in the same transaction. Returns false when the lease no longer
 * matches (someone else owns the row) — nothing is written then.
 */
export async function cancelClaimedDelivery(
  tx: Prisma.TransactionClient,
  claim: ClaimedDelivery,
  reason: string
): Promise<boolean> {
  const { count } = await tx.notificationDelivery.updateMany({
    where: { id: claim.id, status: 'PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'CANCELLED',
      terminalReasonCode: reason,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    },
  })
  if (count !== 1) return false
  await tx.notificationDeliveryAttempt.updateMany({
    where: {
      deliveryId: claim.id,
      attemptNumber: claim.attemptNumber,
      leaseToken: claim.leaseToken,
      outcome: null,
    },
    data: {
      finishedAt: new Date(),
      outcome: NotificationAttemptOutcome.ABANDONED,
      errorCode: NotificationErrorCode.TARGET_REVOKED,
    },
  })
  return true
}
