import { Inject, Injectable } from '@nestjs/common'
import type { User } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { type AppRedisClient, REDIS_CLIENT, RedisLockService } from '../../infrastructure/redis'

import { PrismaService } from '@/prisma'

type UserCacheEnvelope =
  | {
      kind: 'hit'
      user: Record<string, unknown>
    }
  | {
      kind: 'miss'
    }

const USER_CACHE_TTL_MS = 600 * 1000
const NEGATIVE_CACHE_TTL_MS = 60 * 1000
const LOCK_TTL_MS = 5 * 1000
const TAG_TTL_SECONDS = 24 * 60 * 60
const MAX_LOCK_ATTEMPTS = 5
const DATE_FIELDS = ['createdAt', 'updatedAt', 'lastLoginAt'] as const

/**
 * User Cache Service
 *
 * Implements production-ready caching for user data with:
 * - Explicit negative cache envelope
 * - Redis Set based key tracking for invalidation
 * - Hybrid TTL + explicit invalidation
 * - Cache-aside pattern (check cache → DB fallback)
 * - Atomic Redis lock for cache stampede protection
 * - Metrics tracking (hit/miss rate)
 */
@Injectable()
export class UserCacheService {
  private metrics = {
    hits: 0,
    misses: 0,
    dbQueries: 0,
    requests: 0,
  }

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly lock: RedisLockService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(UserCacheService.name)
  }

  async getUser(userId: string): Promise<User | null> {
    this.metrics.requests++
    const cacheKey = this.getUserKey(userId)

    const cached = await this.readUserCache(cacheKey)
    if (cached.found) {
      this.metrics.hits++
      this.logMetrics()
      return cached.user
    }

    this.metrics.misses++
    const lockKey = this.getLockKey(userId)

    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
      const token = await this.lock.acquire(lockKey, LOCK_TTL_MS)

      if (token) {
        try {
          const cachedAfterLock = await this.readUserCache(cacheKey)
          if (cachedAfterLock.found) {
            this.metrics.hits++
            this.logMetrics()
            return cachedAfterLock.user
          }

          return await this.fetchAndCacheUser(userId)
        } finally {
          await this.lock.release(lockKey, token)
        }
      }

      await this.sleep(this.jitterMs())

      const cachedAfterWait = await this.readUserCache(cacheKey)
      if (cachedAfterWait.found) {
        this.metrics.hits++
        this.logMetrics()
        return cachedAfterWait.user
      }
    }

    this.logger.warn(
      { userId, attempts: MAX_LOCK_ATTEMPTS },
      'User cache lock contention timeout, falling back to DB'
    )

    return this.fetchAndCacheUser(userId)
  }

  async invalidateUser(userId: string): Promise<void> {
    const tagKey = this.getTagKey(userId)
    const primaryKey = this.getUserKey(userId)
    const cacheKeys = await this.redis.sMembers(tagKey)
    const keysToDelete = Array.from(new Set([primaryKey, ...cacheKeys, tagKey]))

    if (keysToDelete.length === 0) {
      this.logger.debug(`No cache keys to invalidate for user ${userId}`)
      return
    }

    const multi = this.redis.multi()
    for (const key of keysToDelete) {
      multi.del(key)
    }
    await multi.exec()

    this.logger.info(
      { userId, keysInvalidated: keysToDelete.length - 1 },
      `Invalidated ${keysToDelete.length - 1} cache keys for user ${userId}`
    )
  }

  async invalidateUsers(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.invalidateUser(userId)))

    this.logger.info({ count: userIds.length }, `Batch invalidated ${userIds.length} users`)
  }

  getMetrics(): {
    hits: number
    misses: number
    dbQueries: number
    hitRate: string
    total: number
  } {
    const total = this.metrics.hits + this.metrics.misses
    const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0

    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      dbQueries: this.metrics.dbQueries,
      hitRate: hitRate.toFixed(2) + '%',
      total,
    }
  }

  resetMetrics(): void {
    this.metrics = { hits: 0, misses: 0, dbQueries: 0, requests: 0 }
  }

  private async fetchAndCacheUser(userId: string): Promise<User | null> {
    this.metrics.dbQueries++
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      await this.redis.set(
        this.getUserKey(userId),
        JSON.stringify({ kind: 'miss' } satisfies UserCacheEnvelope),
        {
          expiration: { type: 'PX', value: NEGATIVE_CACHE_TTL_MS },
        }
      )
      return null
    }

    await this.redis.set(
      this.getUserKey(userId),
      JSON.stringify({ kind: 'hit', user } satisfies UserCacheEnvelope),
      {
        expiration: { type: 'PX', value: USER_CACHE_TTL_MS },
      }
    )

    await this.trackCacheKey(userId, this.getUserKey(userId))

    this.logger.debug({ userId, ttlMs: USER_CACHE_TTL_MS }, `User ${userId} cached from DB`)

    return user
  }

  private async readUserCache(
    cacheKey: string
  ): Promise<{ found: true; user: User | null } | { found: false }> {
    const raw = await this.redis.get(cacheKey)
    if (raw === null) {
      return { found: false }
    }

    try {
      const parsed = JSON.parse(raw) as UserCacheEnvelope

      if (parsed.kind === 'miss') {
        return { found: true, user: null }
      }

      if (parsed.kind === 'hit' && parsed.user && typeof parsed.user === 'object') {
        return { found: true, user: this.reviveUser(parsed.user) }
      }
    } catch {
      // Fall through to cache deletion below.
    }

    await this.redis.del(cacheKey)
    return { found: false }
  }

  private reviveUser(serialized: Record<string, unknown>): User {
    for (const field of DATE_FIELDS) {
      const value = serialized[field]
      if (typeof value === 'string') {
        serialized[field] = new Date(value)
      }
    }

    return serialized as unknown as User
  }

  private async trackCacheKey(userId: string, cacheKey: string): Promise<void> {
    const tagKey = this.getTagKey(userId)
    const multi = this.redis.multi()
    multi.sAdd(tagKey, cacheKey)
    multi.expire(tagKey, TAG_TTL_SECONDS)
    await multi.exec()
  }

  private getUserKey(userId: string): string {
    return `auth:user:v2:${userId}`
  }

  private getLockKey(userId: string): string {
    return `auth:lock:user:v2:${userId}`
  }

  private getTagKey(userId: string): string {
    return `auth:user:v2:${userId}:keys`
  }

  private jitterMs(): number {
    return 50 + Math.floor(Math.random() * 101)
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private logMetrics(): void {
    if (this.metrics.requests % 100 === 0) {
      const metrics = this.getMetrics()
      this.logger.info(metrics, 'Cache metrics')
    }
  }
}
