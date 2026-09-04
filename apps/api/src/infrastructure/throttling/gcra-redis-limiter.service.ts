import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { MetricsService } from '../observability'
import { REDIS_CLIENT } from '../redis/redis.constants'
import type { AppRedisClient } from '../redis/redis-connection.service'

import {
  DEGRADE_LOG_INTERVAL_MS,
  GCRA_SCRIPT,
  KEY_PREFIX,
  REDIS_CALL_TIMEOUT_MS,
} from './gcra.constants'
import { GcraMemoryLimiter } from './gcra-memory-limiter'
import type { RateLimitDecision, RateLimiter } from './rate-limit-decision'
import { type RateLimitPolicy, resolveBurst } from './rate-limit-policies'

/**
 * Redis-backed GCRA limiter (ADR-039/ADR-073) — the global rate-limit
 * backstop's storage, shared across API replicas instead of process-local.
 * Auth/API-key/invite abuse limiters are separate and unchanged.
 *
 * On a slow or erroring Redis the call degrades to a held in-memory
 * `GcraMemoryLimiter` (today's per-process behaviour) rather than failing
 * the request open — a Redis blip must not become a full API outage.
 */
@Injectable()
export class GcraRedisLimiter implements RateLimiter, OnApplicationShutdown {
  /** Held singleton: a fresh fallback per call would reset counts == fail-open. */
  private readonly fallback = new GcraMemoryLimiter()
  private lastDegradeLogAt = 0

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(GcraRedisLimiter.name)
  }

  async consume(key: string, policy: RateLimitPolicy, cost = 1): Promise<RateLimitDecision> {
    try {
      return await this.withTimeout(this.consumeRedis(key, policy, cost))
    } catch (err) {
      this.metrics.incRedisClientEvent('throttler', 'degraded')
      this.logDegraded(err)
      return this.fallback.consume(key, policy, cost)
    }
  }

  /** Delete only this limiter's keys — used by e2e cleanup, never `FLUSHDB`. */
  async reset(): Promise<void> {
    for await (const keys of this.redis.scanIterator({ MATCH: `${KEY_PREFIX}*`, COUNT: 100 })) {
      if (keys.length > 0) await this.redis.unlink(keys)
    }
    this.fallback.reset()
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown()
  }

  private async consumeRedis(
    key: string,
    policy: RateLimitPolicy,
    cost: number
  ): Promise<RateLimitDecision> {
    const burst = resolveBurst(policy)
    const reply = (await this.redis.eval(GCRA_SCRIPT, {
      keys: [`${KEY_PREFIX}${key}`],
      arguments: [String(policy.rate), String(policy.per), String(burst), String(cost)],
    })) as [number, number, number, number]

    const [allowed, remaining, retryAfterMs, resetAfterMs] = reply
    return { allowed: allowed === 1, remaining, retryAfterMs, resetAfterMs }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('redis rate-limiter call timed out')),
        REDIS_CALL_TIMEOUT_MS
      )
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  private logDegraded(err: unknown): void {
    const now = Date.now()
    if (now - this.lastDegradeLogAt < DEGRADE_LOG_INTERVAL_MS) return
    this.lastDegradeLogAt = now
    this.logger.error({ err }, 'Rate-limiter Redis unavailable; degraded to local in-memory limits')
  }
}
