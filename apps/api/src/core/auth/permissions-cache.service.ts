import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { type AppRedisClient, REDIS_CLIENT, RedisLockService } from '../../infrastructure/redis'

import { memberPermissionSnapshot } from './member-permission-snapshot'

import type { Permission } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

const PERMISSIONS_CACHE_TTL_MS = 3600 * 1000
const LOCK_TTL_MS = 5 * 1000
const MAX_LOCK_ATTEMPTS = 5

/**
 * Permissions Cache Service
 *
 * Caches user permissions for RBAC with automatic invalidation via aclVersion.
 *
 * Architecture:
 * - Cache key: auth:perm:v2:{orgId}:{userId}:{aclVersion}
 * - When admin changes permissions → bump aclVersion in Organization
 * - Old cache keys become stale automatically (different version)
 * - Raw Redis GET null is cache miss; JSON arrays, including [], are cache hits
 * - Atomic Redis lock prevents cache stampede on miss
 */
@Injectable()
export class PermissionsCacheService {
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
    private readonly logger: PinoLogger,
    private readonly prometheus: MetricsService
  ) {
    this.logger.setContext(PermissionsCacheService.name)
  }

  async getPermissions(
    userId: string,
    organizationId: string,
    aclVersion: number
  ): Promise<Permission[]> {
    this.metrics.requests++
    const cacheKey = this.getPermissionsKey(userId, organizationId, aclVersion)

    const cached = await this.readPermissionsCache(cacheKey)
    if (cached !== null) {
      this.metrics.hits++
      this.logMetrics()
      return cached
    }

    this.metrics.misses++
    const lockKey = this.getLockKey(userId, organizationId)

    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
      const token = await this.lock.acquire(lockKey, LOCK_TTL_MS)

      if (token) {
        try {
          const cachedAfterLock = await this.readPermissionsCache(cacheKey)
          if (cachedAfterLock !== null) {
            this.metrics.hits++
            this.logMetrics()
            return cachedAfterLock
          }

          return await this.fetchAndCachePermissions(userId, organizationId, aclVersion)
        } finally {
          await this.lock.release(lockKey, token)
        }
      }

      await this.sleep(this.jitterMs())

      const cachedAfterWait = await this.readPermissionsCache(cacheKey)
      if (cachedAfterWait !== null) {
        this.metrics.hits++
        this.logMetrics()
        return cachedAfterWait
      }
    }

    this.logger.warn(
      { userId, organizationId, aclVersion, attempts: MAX_LOCK_ATTEMPTS },
      'Permissions cache lock contention timeout, falling back to DB'
    )

    return this.fetchAndCachePermissions(userId, organizationId, aclVersion)
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

  private async fetchAndCachePermissions(
    userId: string,
    organizationId: string,
    aclVersion: number
  ): Promise<Permission[]> {
    this.metrics.dbQueries++
    this.prometheus.incCacheOperation('permissions', 'db_fallback')
    const permissions = await this.loadPermissionsFromDb(userId, organizationId)

    await this.redis.set(
      this.getPermissionsKey(userId, organizationId, aclVersion),
      JSON.stringify(permissions),
      {
        expiration: { type: 'PX', value: PERMISSIONS_CACHE_TTL_MS },
      }
    )

    this.logger.debug(
      {
        userId,
        organizationId,
        aclVersion,
        permissionsCount: permissions.length,
        ttlMs: PERMISSIONS_CACHE_TTL_MS,
      },
      `Permissions cached for user ${userId} in org ${organizationId}`
    )

    return permissions
  }

  private async readPermissionsCache(cacheKey: string): Promise<Permission[] | null> {
    const raw = await this.redis.get(cacheKey)
    if (raw === null) {
      this.prometheus.incCacheOperation('permissions', 'miss')
      return null
    }

    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.prometheus.incCacheOperation('permissions', 'hit')
        return parsed as Permission[]
      }
    } catch {
      // Fall through to cache deletion below.
    }

    await this.redis.del(cacheKey)
    this.prometheus.incCacheOperation('permissions', 'corrupt')
    this.prometheus.incCacheOperation('permissions', 'miss')
    return null
  }

  private async loadPermissionsFromDb(
    userId: string,
    organizationId: string
  ): Promise<Permission[]> {
    // The supplied version is a cache-selection fence, not the exact revision
    // of this snapshot. Concurrent changes may yield newer coherent rules under
    // an old fence; later requests select the newly committed version instead.
    const snapshot = await this.prisma.$transaction(
      (tx) => memberPermissionSnapshot(tx, userId, organizationId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
    if (!snapshot.memberId) {
      this.logger.warn({ userId, organizationId }, 'User is not a member of org')
      return []
    }
    if (snapshot.unsafe.length > 0)
      this.logger.warn(
        {
          userId,
          organizationId,
          roleIds: snapshot.unsafe.map(({ role }) => role.id),
          roleOrganizationIds: snapshot.unsafe.map(({ role }) => role.organizationId),
          roleIsSystem: snapshot.unsafe.map(({ role }) => role.isSystem),
        },
        'OA-05: dropping role(s) that fail the role-assignability rule'
      )
    return snapshot.permissions
  }

  private getPermissionsKey(userId: string, organizationId: string, aclVersion: number): string {
    return `auth:perm:v2:${organizationId}:${userId}:${aclVersion}`
  }

  private getLockKey(userId: string, organizationId: string): string {
    return `auth:lock:perm:v2:${organizationId}:${userId}`
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
      this.logger.info(metrics, 'Permissions cache metrics')
    }
  }
}
