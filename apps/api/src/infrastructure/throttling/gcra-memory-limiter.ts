import type { OnApplicationShutdown } from '@nestjs/common'

import type { RateLimitDecision, RateLimiter } from './rate-limit-decision'
import { type RateLimitPolicy, resolveBurst } from './rate-limit-policies'

const SWEEP_INTERVAL_MS = 30_000

/**
 * Process-local GCRA limiter — the same math as `gcra.constants.ts`'s Lua
 * script, using `Date.now()` (fine here: this path is per-process by
 * definition, unlike the Redis path where cross-replica clock skew would be
 * a real correctness bug). Used directly in tests and as `GcraRedisLimiter`'s
 * degrade-on-timeout fallback.
 *
 * A held `Map<key, tat>` — a fresh instance per call would reset counts,
 * i.e. fail open. Idle keys are evicted lazily on access plus a periodic
 * sweep so an abandoned key doesn't sit in memory forever.
 */
export class GcraMemoryLimiter implements RateLimiter, OnApplicationShutdown {
  private readonly tatByKey = new Map<string, number>()
  private readonly sweepTimer: NodeJS.Timeout

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.sweepTimer.unref()
  }

  async consume(key: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    const burst = resolveBurst(policy)
    const emission = policy.per / policy.rate
    const increment = emission * cost
    const now = Date.now()
    const tat = this.tatByKey.get(key) ?? now
    const newTat = Math.max(tat, now) + increment
    const allowAt = newTat - emission * burst
    const diff = now - allowAt

    if (diff < 0) {
      const retryAfterMs = increment <= emission * burst ? Math.ceil(-diff) : -1
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
        resetAfterMs: Math.ceil(Math.max(0, tat - now)),
      }
    }

    this.tatByKey.set(key, newTat)
    return {
      allowed: true,
      remaining: Math.floor(diff / emission),
      retryAfterMs: -1,
      resetAfterMs: Math.ceil(newTat - now),
    }
  }

  /** Test-only: drop all held state so a fresh scenario starts idle. */
  reset(): void {
    this.tatByKey.clear()
  }

  onApplicationShutdown(): void {
    clearInterval(this.sweepTimer)
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, tat] of this.tatByKey) {
      if (tat <= now) this.tatByKey.delete(key)
    }
  }
}
