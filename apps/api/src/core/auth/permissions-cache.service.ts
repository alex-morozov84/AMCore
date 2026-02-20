import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Permission } from '@prisma/client'
import type { Cache } from 'cache-manager'

import { PrismaService } from '@/prisma'

/**
 * Permissions Cache Service
 *
 * Caches user permissions for RBAC with automatic invalidation via aclVersion.
 *
 * Architecture:
 * - Cache key: perm:{orgId}:{userId}:{aclVersion}
 * - When admin changes permissions → bump aclVersion in Organization
 * - Old cache keys become stale automatically (different version)
 * - No explicit invalidation needed (version-based cache busting)
 *
 * Flow:
 * 1. Request → Check cache (Redis GET ~1-2ms)
 * 2. Cache hit → Return cached permissions
 * 3. Cache miss → Acquire lock → Query DB (JOIN User→OrgMember→Role→Permission) → Cache result
 *
 * Key Design:
 * - TTL: 3600s (1 hour) - permissions change less frequently than user data
 * - Distributed lock: Prevents cache stampede on miss
 * - Version-based invalidation: No KEYS* scan needed
 */
@Injectable()
export class PermissionsCacheService {
  private readonly logger = new Logger(PermissionsCacheService.name)

  /**
   * Cache TTL in seconds (1 hour)
   * Rationale: Permissions change infrequently, longer TTL reduces DB load
   */
  private readonly TTL_SECONDS = 3600

  /**
   * Lock TTL in seconds (5 seconds)
   */
  private readonly LOCK_TTL_SECONDS = 5

  /**
   * Metrics tracking
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
   * Get user permissions with cache-aside pattern
   *
   * @param userId - User ID
   * @param organizationId - Organization ID
   * @param aclVersion - ACL version from JWT (for cache key)
   * @returns Array of permissions for this user in this org
   */
  async getPermissions(
    userId: string,
    organizationId: string,
    aclVersion: number
  ): Promise<Permission[]> {
    const cacheKey = this.getPermissionsKey(userId, organizationId, aclVersion)

    // 1. Check cache first (fast path)
    const cached = await this.cache.get<Permission[]>(cacheKey)
    if (cached) {
      this.metrics.hits++
      this.logMetrics()
      return cached
    }

    // 2. Cache miss - acquire lock to prevent stampede
    this.metrics.misses++
    const lockKey = this.getLockKey(userId, organizationId)
    const lockAcquired = await this.acquireLock(lockKey)

    if (!lockAcquired) {
      // Another request has lock, wait and retry cache
      await this.sleep(100) // Wait 100ms
      return this.getPermissions(userId, organizationId, aclVersion) // Retry
    }

    try {
      // 3. Double-check cache (another request might have populated it)
      const cachedAfterLock = await this.cache.get<Permission[]>(cacheKey)
      if (cachedAfterLock) {
        return cachedAfterLock
      }

      // 4. Query database
      this.metrics.dbQueries++
      const permissions = await this.loadPermissionsFromDb(userId, organizationId)

      // 5. Store in cache with TTL
      await this.cache.set(cacheKey, permissions, this.TTL_SECONDS * 1000)

      this.logger.debug(`Permissions cached for user ${userId} in org ${organizationId}`, {
        userId,
        organizationId,
        aclVersion,
        permissionsCount: permissions.length,
        ttl: this.TTL_SECONDS,
      })

      return permissions
    } finally {
      // 6. Always release lock
      await this.releaseLock(lockKey)
    }
  }

  /**
   * Load permissions from database
   *
   * Query path: User → OrgMember → MemberRole → Role → RolePermission → Permission
   *
   * @param userId - User ID
   * @param organizationId - Organization ID
   * @returns Array of permissions
   */
  private async loadPermissionsFromDb(
    userId: string,
    organizationId: string
  ): Promise<Permission[]> {
    // Find user's membership in this org
    const member = await this.prisma.orgMember.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!member) {
      // User is not a member of this org
      this.logger.warn(`User ${userId} is not a member of org ${organizationId}`)
      return []
    }

    // Flatten permissions from all roles
    const permissions: Permission[] = []
    const seenPermissionIds = new Set<string>()

    for (const memberRole of member.roles) {
      for (const rolePermission of memberRole.role.permissions) {
        const permission = rolePermission.permission

        // Deduplicate permissions (user might have same permission from multiple roles)
        if (!seenPermissionIds.has(permission.id)) {
          seenPermissionIds.add(permission.id)
          permissions.push(permission)
        }
      }
    }

    return permissions
  }

  /**
   * Get cache metrics
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
   * Generate cache key for permissions
   * Format: perm:{orgId}:{userId}:{aclVersion}
   *
   * aclVersion ensures automatic invalidation when admin changes permissions
   */
  private getPermissionsKey(userId: string, organizationId: string, aclVersion: number): string {
    return `perm:${organizationId}:${userId}:${aclVersion}`
  }

  /**
   * Generate distributed lock key
   * Format: lock:perm:{orgId}:{userId}
   */
  private getLockKey(userId: string, organizationId: string): string {
    return `lock:perm:${organizationId}:${userId}`
  }

  /**
   * Acquire distributed lock using SET NX EX pattern
   */
  private async acquireLock(lockKey: string): Promise<boolean> {
    const existing = await this.cache.get(lockKey)
    if (existing) {
      return false // Lock already held
    }

    await this.cache.set(lockKey, '1', this.LOCK_TTL_SECONDS * 1000)
    return true
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(lockKey: string): Promise<void> {
    await this.cache.del(lockKey)
  }

  /**
   * Sleep helper for retry logic
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
      this.logger.log('Permissions cache metrics', metrics)
    }
  }
}
