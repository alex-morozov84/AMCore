import type { JobOptions } from '@/infrastructure/queue/interfaces/job-options.interface'
import { DEFAULT_JOB_OPTIONS } from '@/infrastructure/queue/interfaces/job-options.interface'

/**
 * Durable dispatch constants (ADR-052; owner-confirmed 2026-06-18). Postgres owns the
 * retry budget and schedule — these are starter defaults tuned by code change, not env
 * (matching the cleanup/limiter convention).
 */

/** Max delivery attempts for an external channel before the delivery is FAILED. */
export const NOTIFICATION_EXTERNAL_MAX_ATTEMPTS = 5

/** In-app is a single synchronous attempt (inserted DELIVERED at produce time). */
export const NOTIFICATION_IN_APP_MAX_ATTEMPTS = 1

/**
 * Lease TTL for a claimed (`PROCESSING`) delivery. Comfortably exceeds a bounded
 * provider call so a healthy worker renews/finalizes before expiry; a crashed worker's
 * lease expires and the reaper reclaims the row.
 */
export const NOTIFICATION_LEASE_TTL_MS = 2 * 60 * 1000 // 2 min

/** Bounded provider I/O timeout per delivery attempt (well under the lease TTL). */
export const NOTIFICATION_PROVIDER_TIMEOUT_MS = 10 * 1000 // 10 s

/** Max deliveries claimed per SKIP-LOCKED pass; the drain loops until a pass is short. */
export const NOTIFICATION_CLAIM_BATCH_LIMIT = 50

/** Max expired-lease rows reaped per pass (bounded, like the claim). */
export const NOTIFICATION_REAP_BATCH_LIMIT = 50

/**
 * Upper bound on claim batches drained per dispatch invocation, so a single wake/cron
 * run cannot loop unbounded under a large backlog (the next run continues the drain).
 */
export const NOTIFICATION_MAX_DRAIN_CYCLES = 20

/** Exponential backoff schedule for `RETRY_SCHEDULED` (Postgres owns the schedule). */
export const NOTIFICATION_BACKOFF_BASE_MS = 30 * 1000 // 30 s → 60 → 120 → 240
export const NOTIFICATION_BACKOFF_CAP_MS = 15 * 60 * 1000 // 15 min
export const NOTIFICATION_BACKOFF_JITTER = 0.2 // ±20% full jitter

/**
 * Defensive max for a provider-requested retry **floor** (e.g. Telegram `retry_after`). A
 * legitimate flood-wait can be minutes; we honor it as a floor over the normal backoff, but
 * clamp a corrupt/absurd value so a row never parks indefinitely. Deliberately NOT the
 * 15-min normal-backoff cap (corr. E) — that would retry before the provider's requested delay.
 */
export const NOTIFICATION_RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000 // 24 h

/**
 * Bounded terminal reasons (`NotificationDelivery.terminalReasonCode`). Machine-readable,
 * never a provider body or free text.
 */
export const NotificationTerminalReason = {
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  DESTINATION_UNVERIFIED: 'destination_unverified',
  NO_ADAPTER: 'no_adapter',
  PERMANENT_FAILURE: 'permanent_failure',
} as const

/**
 * Bounded attempt error codes (`NotificationDeliveryAttempt.errorCode`). Generic codes
 * here; a channel adapter may add its own bounded codes (e.g. email) in its module.
 */
export const NotificationErrorCode = {
  LEASE_EXPIRED: 'lease_expired',
  NO_ADAPTER: 'no_adapter',
  NOTIFICATION_MISSING: 'notification_missing',
  PROVIDER_TRANSIENT: 'provider_transient',
  PROVIDER_PERMANENT: 'provider_permanent',
  PROVIDER_TIMEOUT: 'provider_timeout',
  PROVIDER_ERROR: 'provider_error',
} as const

/**
 * BullMQ wake-job options for `QueueName.NOTIFICATIONS` / `DISPATCH_DUE`. ONE attempt
 * and no backoff: the wake job only nudges the dispatcher to drain due work; Postgres
 * owns retry (ADR-052 / the ADR-006 amendment), so BullMQ must NOT become a retry
 * owner. No stable `jobId` dedupe — duplicate wakes are harmless because the DB
 * `FOR UPDATE SKIP LOCKED` claim is the real dedupe. The shared retain/cleanup policy
 * from `DEFAULT_JOB_OPTIONS` is kept.
 */
export const NOTIFICATION_WAKE_JOB_OPTIONS: JobOptions = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 1,
  backoff: undefined,
}
