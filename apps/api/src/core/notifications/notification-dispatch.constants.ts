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
