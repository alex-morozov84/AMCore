import {
  NOTIFICATION_BACKOFF_BASE_MS,
  NOTIFICATION_BACKOFF_CAP_MS,
  NOTIFICATION_BACKOFF_JITTER,
  NOTIFICATION_RETRY_AFTER_MAX_MS,
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

/**
 * Apply a provider-requested retry **floor** to the computed backoff (corr. E). The next
 * attempt is the LATER of the normal jittered backoff and `now + retryAfterMs`, so we never
 * retry before the provider's requested delay, and never earlier than the normal schedule.
 * The floor is clamped to `NOTIFICATION_RETRY_AFTER_MAX_MS` (24h) so a corrupt value can't
 * park a row indefinitely. `undefined`/non-positive → the plain backoff.
 */
export function applyRetryAfterFloor(
  backoffAt: Date,
  retryAfterMs: number | undefined,
  now: Date = new Date()
): Date {
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return backoffAt
  }
  const clamped = Math.min(retryAfterMs, NOTIFICATION_RETRY_AFTER_MAX_MS)
  const floorAt = new Date(now.getTime() + clamped)
  return floorAt > backoffAt ? floorAt : backoffAt
}
