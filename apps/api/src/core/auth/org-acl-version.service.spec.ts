import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { NotFoundException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { type AppRedisClient, REDIS_CLIENT } from '../../infrastructure/redis'
import { PrismaService } from '../../prisma'

import { OrgAclVersionService } from './org-acl-version.service'

describe('OrgAclVersionService', () => {
  let service: OrgAclVersionService
  let redis: jest.Mocked<Pick<AppRedisClient, 'get' | 'set' | 'del'>>
  let prisma: { organization: { findUnique: jest.Mock } }
  let env: jest.Mocked<Pick<EnvService, 'get'>>
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn' | 'error'>>

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<Pick<AppRedisClient, 'get' | 'set' | 'del'>>
    prisma = { organization: { findUnique: jest.fn() } }
    env = { get: jest.fn().mockReturnValue(0) } as unknown as jest.Mocked<Pick<EnvService, 'get'>>
    logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Pick<PinoLogger, 'setContext' | 'warn' | 'error'>>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgAclVersionService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: PrismaService, useValue: prisma },
        { provide: EnvService, useValue: env },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile()

    service = module.get(OrgAclVersionService)
  })

  it('returns aclVersion from Redis cache hit without DB lookup', async () => {
    redis.get.mockResolvedValueOnce('7')

    await expect(service.getCurrent('org-1')).resolves.toBe(7)

    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(service.getMetrics().hits).toBe(1)
  })

  it('loads aclVersion from DB on cache miss and caches without TTL by default', async () => {
    redis.get.mockResolvedValueOnce(null)
    prisma.organization.findUnique.mockResolvedValueOnce({ aclVersion: 8 })

    await expect(service.getCurrent('org-1')).resolves.toBe(8)

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { aclVersion: true },
    })
    expect(redis.set).toHaveBeenCalledWith('auth:org:aclv:v1:org-1', '8')
    expect(service.getMetrics()).toMatchObject({ misses: 1, dbQueries: 1 })
  })

  it('uses TTL cache mode when RBAC_ACLV_CACHE_TTL_MS is configured', async () => {
    env.get.mockReturnValueOnce(5000 as never)
    redis.get.mockResolvedValueOnce(null)
    prisma.organization.findUnique.mockResolvedValueOnce({ aclVersion: 9 })

    await expect(service.getCurrent('org-1')).resolves.toBe(9)

    expect(redis.set).toHaveBeenCalledWith('auth:org:aclv:v1:org-1', '9', {
      expiration: { type: 'PX', value: 5000 },
    })
  })

  it('falls back to authoritative DB lookup when Redis read fails', async () => {
    redis.get.mockRejectedValueOnce(new Error('redis down'))
    prisma.organization.findUnique.mockResolvedValueOnce({ aclVersion: 10 })

    await expect(service.getCurrent('org-1')).resolves.toBe(10)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
      expect.stringContaining('falling back to DB')
    )
    expect(service.getMetrics().redisReadFailures).toBe(1)
  })

  it('throws NotFoundException when DB has no organization record', async () => {
    redis.get.mockResolvedValueOnce(null)
    prisma.organization.findUnique.mockResolvedValueOnce(null)

    await expect(service.getCurrent('org-missing')).rejects.toThrow(NotFoundException)
  })

  it('invalidates Redis cache key', async () => {
    await service.invalidate('org-1')
    expect(redis.del).toHaveBeenCalledWith('auth:org:aclv:v1:org-1')
  })

  it('records error-level freshness incident when invalidation fails but does not throw', async () => {
    redis.del.mockRejectedValueOnce(new Error('redis down'))

    await expect(service.invalidate('org-1')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        metric: 'auth.rbac.aclv_invalidate_failure',
      }),
      expect.stringContaining('invalidation failed')
    )
    expect(service.getMetrics().invalidateFailures).toBe(1)
  })
})
