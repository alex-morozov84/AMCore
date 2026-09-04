import type { RateLimitPolicy } from './rate-limit-policies'

/** GCRA admission decision, shared by both limiter implementations. */
export interface RateLimitDecision {
  allowed: boolean
  /** Requests still admittable from idle right now (0 when refused). */
  remaining: number
  /** Milliseconds until the next request would be admitted; -1 when allowed. */
  retryAfterMs: number
  /** Milliseconds until the bucket is idle-full again. */
  resetAfterMs: number
}

/** Implemented by both `GcraRedisLimiter` and `GcraMemoryLimiter`. */
export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy, cost?: number): Promise<RateLimitDecision>
}
