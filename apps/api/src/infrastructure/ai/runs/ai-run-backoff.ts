import {
  AI_RUN_BACKOFF_BASE_MS,
  AI_RUN_BACKOFF_CAP_MS,
  AI_RUN_BACKOFF_JITTER,
  AI_RUN_RETRY_AFTER_MAX_MS,
} from './ai-run.constants'

/**
 * Exponential backoff with full jitter for the next run retry (ADR-052: Postgres owns the retry
 * schedule). `attemptCount` is the number of attempts already made — so after the first failure
 * (`attemptCount = 1`) the base delay applies, doubling each subsequent attempt, capped, then
 * jittered by ±`AI_RUN_BACKOFF_JITTER` to spread retries across workers and avoid a thundering herd.
 */
export function computeNextRunAttemptAt(attemptCount: number, now: Date = new Date()): Date {
  const exponent = Math.max(0, attemptCount - 1)
  const base = AI_RUN_BACKOFF_BASE_MS * 2 ** exponent
  const capped = Math.min(base, AI_RUN_BACKOFF_CAP_MS)
  const jitterFactor = 1 + (Math.random() * 2 - 1) * AI_RUN_BACKOFF_JITTER
  const delay = Math.round(capped * jitterFactor)
  return new Date(now.getTime() + delay)
}

/**
 * Apply a provider-requested retry **floor** to the computed backoff. The next attempt is the LATER
 * of the normal jittered backoff and `now + retryAfterMs`, clamped to `AI_RUN_RETRY_AFTER_MAX_MS`
 * so a corrupt value can't park a run indefinitely. `undefined`/non-positive → the plain backoff.
 */
export function applyRunRetryAfterFloor(
  backoffAt: Date,
  retryAfterMs: number | undefined,
  now: Date = new Date()
): Date {
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return backoffAt
  }
  const clamped = Math.min(retryAfterMs, AI_RUN_RETRY_AFTER_MAX_MS)
  const floorAt = new Date(now.getTime() + clamped)
  return floorAt > backoffAt ? floorAt : backoffAt
}
