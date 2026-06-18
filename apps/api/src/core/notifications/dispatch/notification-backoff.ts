import {
  NOTIFICATION_BACKOFF_BASE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_BACKOFF_JITTER,
} from '../notification-dispatch.constants'

/**
 * Exponential backoff with full jitter for the next retry (ADR-052: Postgres owns the
 * retry schedule). `attemptCount` is the number of attempts already made — so after the
 * first failure (`attemptCount = 1`) the base delay applies, doubling each subsequent
 * attempt, capped, then jittered by ±`NOTIFICATION_BACKOFF_JITTER` to spread retries
 * across workers/replicas and avoid a thundering herd.
 */
export function computeNextAttemptAt(attemptCount: number, now: Date = new Date()): Date {
  const exponent = Math.max(0, attemptCount - 1)
  const base = NOTIFICATION_BACKOFF_BASE_MS * 2 ** exponent
  const capped = Math.min(base, NOTIFICATION_BACKOFF_CAP_MS)
  // Full jitter: multiply by a factor uniformly in [1 - jitter, 1 + jitter].
  const jitterFactor = 1 + (Math.random() * 2 - 1) * NOTIFICATION_BACKOFF_JITTER
  const delay = Math.round(capped * jitterFactor)
  return new Date(now.getTime() + delay)
}
