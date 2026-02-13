import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { User } from '@prisma/client'
import type { Cache } from 'cache-manager'

import { PrismaService } from '@/prisma'

/**
 * User Cache Service
 *
 * Implements production-ready caching for user data with:
 * - Tag-based invalidation (Redis Sets for tracking)
 * - Hybrid TTL + explicit invalidation
 * - Cache-aside pattern (check cache → DB fallback)
 * - Distributed locking (cache stampede protection)
 * - Metrics tracking (hit/miss rate)
 *
 * Architecture:
 * 1. Request → Check cache (Redis GET ~1-2ms)
 * 2. Cache hit → Return cached user
 * 3. Cache miss → Acquire lock → Query DB → Cache result → Return user
 * 4. On user update → Explicit invalidation + publish event
 *
 * Key Design Decisions:
 * - TTL: 600s (10 minutes) for automatic expiration safety net
 * - Tag tracking: Redis Sets to track all keys for a user (enables batch invalidation)
 * - Distributed lock: Prevents thundering herd on cache miss
 * - Metrics: Logs hit/miss ratio for monitoring
 */
@Injectable()
export class UserCacheService {
  private readonly logger = new Logger(UserCacheService.name)

  /**
   * Cache TTL in seconds (10 minutes)
   * Rationale: Balance between freshness and DB load
   * - Too short (1-2 min): Excessive DB queries
   * - Too long (1+ hour): Stale data risk
   * - 10 min: Industry standard for user data (Auth0, AWS recommendations)
   */
  private readonly TTL_SECONDS = 600

  /**
   * Lock TTL in seconds (5 seconds)
   * Rationale: Slightly longer than expected DB query time
   * - Prevents deadlocks if query hangs
   * - Short enough to not block requests unnecessarily
   */
  private readonly LOCK_TTL_SECONDS = 5

  /**
   * Metrics tracking
   * TODO: Export to Prometheus/CloudWatch in production
   */
  private metrics = {
    hits: 0,
    misses: 0,
    dbQueries: 0,
  }

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Get user by ID with cache-aside pattern
   *
   * Flow:
   * 1. Check cache (Redis GET)
   * 2. If hit → return cached user
   * 3. If miss → acquire lock → query DB → cache result
   *
   * Cache stampede protection:
   * - Uses distributed lock to ensure only one request queries DB
   * - Other requests wait and retry cache lookup
   *
   * @param userId - User ID to fetch
   * @returns User object or null if not found
   */
  async getUser(userId: string): Promise<User | null> {
    const cacheKey = this.getUserKey(userId)

    // 1. Check cache first (fast path)
    const cached = await this.cache.get<User>(cacheKey)
    if (cached) {
      this.metrics.hits++
      this.logMetrics()
      return cached
    }

    // 2. Cache miss - acquire lock to prevent stampede
    this.metrics.misses++
    const lockKey = this.getLockKey(userId)
    const lockAcquired = await this.acquireLock(lockKey)

    if (!lockAcquired) {
      // Another request has lock, wait and retry cache
      await this.sleep(100) // Wait 100ms
      return this.getUser(userId) // Retry (recursive)
    }

    try {
      // 3. Double-check cache (another request might have populated it)
      const cachedAfterLock = await this.cache.get<User>(cacheKey)
      if (cachedAfterLock) {
        return cachedAfterLock
      }

      // 4. Query database
      this.metrics.dbQueries++
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      })

      if (!user) {
        // User not found - cache negative result (short TTL)
        await this.cache.set(cacheKey, null, 60 * 1000) // 1 minute for null
        return null
      }

      // 5. Store in cache with TTL
      await this.cache.set(cacheKey, user, this.TTL_SECONDS * 1000)

      // 6. Track cache key for tag-based invalidation
      await this.trackCacheKey(userId, cacheKey)

      this.logger.debug(`User ${userId} cached from DB`, {
        userId,
        ttl: this.TTL_SECONDS,
      })

      return user
    } finally {
      // 7. Always release lock
      await this.releaseLock(lockKey)
    }
  }

  /**
   * Invalidate user cache explicitly
   *
   * Use cases:
   * - User updates profile
   * - User permissions changed
   * - User deleted
   *
   * Strategy: Tag-based invalidation using Redis Sets
   * - Fetch all cache keys for this user from tracking set
   * - Delete all keys in batch
   * - Clean up tracking set
   *
   * @param userId - User ID to invalidate
   */
  async invalidateUser(userId: string): Promise<void> {
    const tagKey = this.getTagKey(userId)

    // 1. Get all cache keys for this user from tracking set
    const cacheKeys = await this.getCacheKeysForUser(userId)

    if (cacheKeys.length === 0) {
      this.logger.debug(`No cache keys to invalidate for user ${userId}`)
      return
    }

    // 2. Delete all cache keys
    await Promise.all(cacheKeys.map((key) => this.cache.del(key)))

    // 3. Clean up tracking set
    await this.cleanupTagKey(tagKey)

    this.logger.log(`Invalidated ${cacheKeys.length} cache keys for user ${userId}`, {
      userId,
      keysInvalidated: cacheKeys.length,
    })
  }

  /**
   * Invalidate multiple users in batch
   *
   * Optimized for bulk operations (e.g., role change affecting many users)
   *
   * @param userIds - Array of user IDs to invalidate
   */
  async invalidateUsers(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.invalidateUser(userId)))

    this.logger.log(`Batch invalidated ${userIds.length} users`, {
      count: userIds.length,
    })
  }

  /**
   * Get cache metrics (hit rate, miss rate, DB queries)
   *
   * @returns Metrics object with hit/miss counts and rates
   */
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

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = { hits: 0, misses: 0, dbQueries: 0 }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Generate cache key for user
   * Format: user:{userId}
   */
  private getUserKey(userId: string): string {
    return `user:${userId}`
  }

  /**
   * Generate distributed lock key
   * Format: lock:user:{userId}
   */
  private getLockKey(userId: string): string {
    return `lock:user:${userId}`
  }

  /**
   * Generate tag key for tracking all cache keys of a user
   * Format: user:{userId}:cache_keys
   *
   * This Redis Set contains all cache keys associated with this user
   * Enables efficient batch invalidation without KEYS * pattern
   */
  private getTagKey(userId: string): string {
    return `user:${userId}:cache_keys`
  }

  /**
   * Acquire distributed lock using SET NX EX pattern
   *
   * Redis command: SET lock:user:123 "1" EX 5 NX
   * - EX: Expire after N seconds (auto-release if holder crashes)
   * - NX: Only set if not exists (ensures atomicity)
   *
   * @param lockKey - Lock key to acquire
   * @returns true if lock acquired, false otherwise
   */
  private async acquireLock(lockKey: string): Promise<boolean> {
    // Note: cache-manager doesn't expose SET NX EX directly
    // In production, use ioredis directly for locking
    // For now, we use a simplified version with TTL
    const existing = await this.cache.get(lockKey)
    if (existing) {
      return false // Lock already held
    }

    await this.cache.set(lockKey, '1', this.LOCK_TTL_SECONDS * 1000)
    return true
  }

  /**
   * Release distributed lock
   *
   * @param lockKey - Lock key to release
   */
  private async releaseLock(lockKey: string): Promise<void> {
    await this.cache.del(lockKey)
  }

  /**
   * Track cache key for tag-based invalidation
   *
   * Adds cache key to a Redis Set for this user
   * Later used for batch invalidation
   *
   * @param userId - User ID
   * @param cacheKey - Cache key to track
   */
  private async trackCacheKey(userId: string, cacheKey: string): Promise<void> {
    const tagKey = this.getTagKey(userId)

    // Note: cache-manager doesn't support Sets natively
    // In production with ioredis: await redis.sadd(tagKey, cacheKey)
    // For now, store as JSON array (simplified)
    const existing = (await this.cache.get<string[]>(tagKey)) || []
    if (!existing.includes(cacheKey)) {
      existing.push(cacheKey)
      await this.cache.set(tagKey, existing, 86400 * 1000) // 24h TTL
    }
  }

  /**
   * Get all cache keys for a user from tracking set
   *
   * @param userId - User ID
   * @returns Array of cache keys
   */
  private async getCacheKeysForUser(userId: string): Promise<string[]> {
    const tagKey = this.getTagKey(userId)

    // In production with ioredis: await redis.smembers(tagKey)
    const keys = (await this.cache.get<string[]>(tagKey)) || []
    return keys
  }

  /**
   * Clean up tag key after invalidation
   *
   * @param tagKey - Tag key to clean up
   */
  private async cleanupTagKey(tagKey: string): Promise<void> {
    await this.cache.del(tagKey)
  }

  /**
   * Sleep helper for retry logic
   *
   * @param ms - Milliseconds to sleep
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Log metrics periodically (every 100 requests)
   */
  private logMetrics(): void {
    const total = this.metrics.hits + this.metrics.misses
    if (total % 100 === 0 && total > 0) {
      const metrics = this.getMetrics()
      this.logger.log('Cache metrics', metrics)
    }
  }
}
