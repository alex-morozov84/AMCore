import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler'
import { PinoLogger } from 'nestjs-pino'

import { REDIS_CLIENT } from '../redis/redis.constants'
import type { AppRedisClient } from '../redis/redis-connection.service'

import {
  DEGRADE_LOG_INTERVAL_MS,
  INCREMENT_SCRIPT,
  KEY_PREFIX,
  REDIS_CALL_TIMEOUT_MS,
} from './redis-throttler-storage.constants'

interface ThrottlerStorageRecord {
  totalHits: number
  timeToExpire: number
  isBlocked: boolean
  timeToBlockExpire: number
}

/**
 * Redis-backed `ThrottlerStorage` for the global `@nestjs/throttler` guard, so
 * the short/long limits are shared across API replicas instead of being
 * process-local (ADR-039). Auth/API-key/invite abuse limiters are separate and
 * unchanged.
 *
 * On a slow or erroring Redis the call degrades to a held in-memory
 * `ThrottlerStorageService` (today's per-process behaviour) rather than failing
 * the request open — a Redis blip must not become a full API outage.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  /** Held singleton: a fresh fallback per call would reset counts == fail-open. */
  private readonly fallback = new ThrottlerStorageService()
  private lastDegradeLogAt = 0

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(RedisThrottlerStorage.name)
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.withTimeout(
        this.incrementRedis(key, ttl, limit, blockDuration, throttlerName)
      )
    } catch (err) {
      this.logDegraded(err)
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName)
    }
  }

  /** Delete only this storage's keys — used by e2e cleanup, never `FLUSHDB`. */
  async reset(): Promise<void> {
    for await (const keys of this.redis.scanIterator({ MATCH: `${KEY_PREFIX}*`, COUNT: 100 })) {
      if (keys.length > 0) await this.redis.unlink(keys)
    }
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown()
  }

  private async incrementRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `${KEY_PREFIX}${throttlerName}:${key}`
    const reply = (await this.redis.eval(INCREMENT_SCRIPT, {
      keys: [counterKey, `${counterKey}:block`],
      arguments: [String(ttl), String(limit), String(blockDuration)],
    })) as [number, number, number, number]

    const [totalHits, ttlMs, isBlocked, blockMs] = reply
    return {
      totalHits,
      timeToExpire: msToSeconds(ttlMs),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: msToSeconds(blockMs),
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('redis throttler call timed out')),
        REDIS_CALL_TIMEOUT_MS
      )
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  private logDegraded(err: unknown): void {
    const now = Date.now()
    if (now - this.lastDegradeLogAt < DEGRADE_LOG_INTERVAL_MS) return
    this.lastDegradeLogAt = now
    this.logger.error({ err }, 'Throttler Redis unavailable; degraded to local in-memory limits')
  }
}

function msToSeconds(ms: number): number {
  return ms > 0 ? Math.ceil(ms / 1000) : 0
}
