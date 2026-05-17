import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { NotFoundException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { type AppRedisClient, REDIS_CLIENT } from '../../infrastructure/redis'
import { PrismaService } from '../../prisma'

interface OrgAclVersionMetrics {
  hits: number
  misses: number
  dbQueries: number
  redisReadFailures: number
  redisWriteFailures: number
  invalidateFailures: number
}

/**
 * ADR-035 / OA-04: current Organization.aclVersion lookup for JWT
 * principals. The permissions cache is keyed by aclVersion, so stale
 * JWT payloads must not be the source of truth for that version.
 */
@Injectable()
export class OrgAclVersionService {
  private metrics: OrgAclVersionMetrics = {
    hits: 0,
    misses: 0,
    dbQueries: 0,
    redisReadFailures: 0,
    redisWriteFailures: 0,
    invalidateFailures: 0,
  }

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(OrgAclVersionService.name)
  }

  async getCurrent(orgId: string): Promise<number> {
    const key = this.getKey(orgId)

    try {
      const cached = await this.redis.get(key)
      if (cached !== null) {
        const parsed = Number(cached)
        if (Number.isInteger(parsed) && parsed >= 0) {
          this.metrics.hits++
          return parsed
        }

        await this.redis.del(key)
      }
    } catch (err) {
      this.metrics.redisReadFailures++
      this.logger.warn({ err, orgId }, 'RBAC aclVersion cache read failed; falling back to DB')
    }

    this.metrics.misses++
    this.metrics.dbQueries++
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { aclVersion: true },
    })
    if (!org) throw new NotFoundException('Organization', orgId)

    await this.cacheValue(orgId, org.aclVersion)
    return org.aclVersion
  }

  async invalidate(orgId: string): Promise<void> {
    try {
      await this.redis.del(this.getKey(orgId))
    } catch (err) {
      this.metrics.invalidateFailures++
      this.logger.error(
        {
          err,
          orgId,
          metric: 'auth.rbac.aclv_invalidate_failure',
        },
        'RBAC aclVersion cache invalidation failed after ACL mutation commit'
      )
    }
  }

  getMetrics(): OrgAclVersionMetrics {
    return { ...this.metrics }
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      dbQueries: 0,
      redisReadFailures: 0,
      redisWriteFailures: 0,
      invalidateFailures: 0,
    }
  }

  private async cacheValue(orgId: string, aclVersion: number): Promise<void> {
    const ttlMs = this.env.get('RBAC_ACLV_CACHE_TTL_MS')

    try {
      if (ttlMs > 0) {
        await this.redis.set(this.getKey(orgId), String(aclVersion), {
          expiration: { type: 'PX', value: ttlMs },
        })
      } else {
        await this.redis.set(this.getKey(orgId), String(aclVersion))
      }
    } catch (err) {
      this.metrics.redisWriteFailures++
      this.logger.warn({ err, orgId }, 'RBAC aclVersion cache write failed')
    }
  }

  private getKey(orgId: string): string {
    return `auth:org:aclv:v1:${orgId}`
  }
}
