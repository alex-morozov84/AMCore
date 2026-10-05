import type { ClaimedDelivery } from '../dispatch/notification-dispatch.types'
import type { NotificationChannel } from '../notification.constants'

import type { Notification, Prisma } from '@/generated/prisma/client'

/** Everything a deliverer needs for one attempt: the claimed delivery + its notification. */
export interface DeliveryContext {
  delivery: ClaimedDelivery
  notification: Notification
}

/**
 * Provider outcome for one delivery attempt, mapped by the dispatcher to a durable
 * transition: `delivered` → DELIVERED; `transient` → RETRY_SCHEDULED/exhausted;
 * `permanent` → FAILED. Error codes are bounded strings, never provider bodies.
 */
export type DeliveryResult =
  | { status: 'delivered'; providerMessageId?: string }
  | {
      status: 'transient'
      errorCode: string
      /**
       * Optional provider-requested retry **floor** in ms (e.g. Telegram `retry_after`, email
       * `Retry-After`). The dispatcher schedules `max(normalBackoff, now + retryAfterMs)`; a valid
       * value above the 24 h policy maximum is clamped to it (ADR-052) — never below the normal
       * backoff, never the 15-min cap.
       */
      retryAfterMs?: number
    }
  | { status: 'permanent'; errorCode: string }

/** Why a delivery attempt never reached the transport. */
export type NotStartedReason =
  'aborted' | 'closed' | 'lease_lost' | 'lease_expired' | 'target_revoked'

/**
 * The attempt was refused at actual-start admission: NO provider call was made. This is not a
 * finalized state — the row is `CANCELLED` (target refused), owned by someone else (lease lost),
 * or still `PROCESSING` until its lease expires and the reaper reclaims it (expired, closed,
 * aborted); the dispatcher never assumes it is already settled.
 */
export interface NotStarted {
  status: 'not_started'
  reason: NotStartedReason
}

export function isNotStarted(value: unknown): value is NotStarted {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'not_started'
  )
}

/**
 * The single authorization to perform a delivery attempt's external call. A deliverer prepares
 * the message first (render, compose), then hands its ONE transport call over as a closure.
 * `send` is one-shot (a second call throws), opens a short DB transaction (lease fence + renewal,
 * target check), re-checks abort/closed state synchronously after it, and only then invokes the
 * closure in the same continuation — so an already-aborted attempt performs zero provider calls
 * even if the adapter ignores abort. A DB error rejects (fail closed, no call).
 */
export interface DeliveryAdmission {
  send<T>(transport: (signal: AbortSignal) => Promise<T>): Promise<T | NotStarted>
}

/** A channel's verdict that a delivery's target is no longer valid at actual-start admission. */
export interface TargetRefusal {
  /** Bounded `terminalReasonCode` for the cancelled delivery. */
  reason: string
}

/**
 * Worker-role half of a channel (ADR-052): performs the actual provider I/O. Separate
 * from the core `ChannelTargetResolver` so provider clients (`EmailService`, Bot API)
 * never enter the web role. Registered per channel; Telegram/Web Push add their own.
 */
export interface ChannelDeliverer {
  readonly channel: NotificationChannel
  deliver(
    context: DeliveryContext,
    admission: DeliveryAdmission
  ): Promise<DeliveryResult | NotStarted>
  /**
   * Optional target check run INSIDE the admission transaction (before the delivery row lock,
   * preserving the connection → delivery lock order). Reads must take the row lock the channel's
   * revoke path contends on (Telegram: `FOR SHARE` on the connection). Return a refusal to
   * cancel the delivery without any provider call. Never swallow query errors.
   */
  checkTarget?(
    tx: Prisma.TransactionClient,
    context: DeliveryContext
  ): Promise<TargetRefusal | null>
}
