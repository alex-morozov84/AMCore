import { Test, TestingModule } from '@nestjs/testing'
import { SystemRole, type User } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { type AppRedisClient, REDIS_CLIENT, RedisLockService } from '../../infrastructure/redis'

import { UserCacheService } from './user-cache.service'

import { PrismaService } from '@/prisma'

describe('UserCacheService', () => {
  let service: UserCacheService
  let redis: jest.Mocked<Pick<AppRedisClient, 'get' | 'set' | 'del' | 'sMembers' | 'multi'>>
  let lock: jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
  let prisma: PrismaService
  let multi: {
    del: jest.Mock
    sAdd: jest.Mock
    expire: jest.Mock
    exec: jest.Mock
  }
  let mockLogger: jest.Mocked<PinoLogger>

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailCanonical: 'test@example.com',
    emailVerified: true,
    passwordHash: 'hashedPassword',
    name: 'Test User',
    avatarUrl: null,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    lastLoginAt: new Date('2026-01-03T00:00:00.000Z'),
    systemRole: SystemRole.USER,
  }

  const userKey = `auth:user:v2:${mockUser.id}`
  const tagKey = `auth:user:v2:${mockUser.id}:keys`
  const lockKey = `auth:lock:user:v2:${mockUser.id}`

  beforeEach(async () => {
    multi = {
      del: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }

    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      sMembers: jest.fn(),
      multi: jest.fn().mockReturnValue(multi),
    }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCacheService,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
        {
          provide: RedisLockService,
          useValue: {
            acquire: jest.fn(),
            release: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    }).compile()

    service = module.get<UserCacheService>(UserCacheService)
    redis = module.get(REDIS_CLIENT)
    lock = module.get(RedisLockService)
    prisma = module.get<PrismaService>(PrismaService)

    service.resetMetrics()
    jest
      .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getUser', () => {
    it('should return cached user envelope and revive date fields', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify({ kind: 'hit', user: mockUser }))

      const result = await service.getUser(mockUser.id)

      expect(result).toEqual(mockUser)
      expect(result?.createdAt).toBeInstanceOf(Date)
      expect(result?.updatedAt).toBeInstanceOf(Date)
      expect(result?.lastLoginAt).toBeInstanceOf(Date)
      expect(redis.get).toHaveBeenCalledWith(userKey)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
    })

    it('should return null from negative cache without querying database', async () => {
      redis.get.mockResolvedValueOnce(JSON.stringify({ kind: 'miss' }))

      const result = await service.getUser('missing-user')

      expect(result).toBeNull()
      expect(prisma.user.findUnique).not.toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
    })

    it('should query database and cache hit envelope on cache miss', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      const result = await service.getUser(mockUser.id)

      expect(result).toEqual(mockUser)
      expect(lock.acquire).toHaveBeenCalledWith(lockKey, 5000)
      expect(lock.release).toHaveBeenCalledWith(lockKey, 'lock-token')
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      })
      expect(redis.set).toHaveBeenCalledWith(
        userKey,
        JSON.stringify({ kind: 'hit', user: mockUser }),
        {
          expiration: { type: 'PX', value: 600000 },
        }
      )
      expect(multi.sAdd).toHaveBeenCalledWith(tagKey, userKey)
      expect(multi.expire).toHaveBeenCalledWith(tagKey, 86400)
      expect(multi.exec).toHaveBeenCalled()

      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(1)
      expect(metrics.dbQueries).toBe(1)
    })

    it('should cache miss envelope with short TTL when user is not found', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null)

      const result = await service.getUser('non-existent')

      expect(result).toBeNull()
      expect(redis.set).toHaveBeenCalledWith(
        'auth:user:v2:non-existent',
        JSON.stringify({ kind: 'miss' }),
        {
          expiration: { type: 'PX', value: 60000 },
        }
      )
    })

    it('should delete corrupt cache entry and refill from database', async () => {
      redis.get.mockResolvedValueOnce('{bad-json').mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      const result = await service.getUser(mockUser.id)

      expect(result).toEqual(mockUser)
      expect(redis.del).toHaveBeenCalledWith(userKey)
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    })

    it('should wait and retry cache when lock is held by another request', async () => {
      redis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify({ kind: 'hit', user: mockUser }))
      lock.acquire.mockResolvedValueOnce(null)

      const result = await service.getUser(mockUser.id)

      expect(result).toEqual(mockUser)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
      expect(lock.release).not.toHaveBeenCalled()
    })

    it('should fall back to database after lock contention timeout', async () => {
      redis.get.mockResolvedValue(null)
      lock.acquire.mockResolvedValue(null)
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      const result = await service.getUser(mockUser.id)

      expect(result).toEqual(mockUser)
      expect(lock.acquire).toHaveBeenCalledTimes(5)
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    })
  })

  describe('invalidateUser', () => {
    it('should invalidate primary key, tracked keys, and tracking set through MULTI', async () => {
      redis.sMembers.mockResolvedValue([userKey, `${userKey}:profile`])

      await service.invalidateUser(mockUser.id)

      expect(redis.sMembers).toHaveBeenCalledWith(tagKey)
      expect(redis.multi).toHaveBeenCalled()
      expect(multi.del).toHaveBeenCalledWith(userKey)
      expect(multi.del).toHaveBeenCalledWith(`${userKey}:profile`)
      expect(multi.del).toHaveBeenCalledWith(tagKey)
      expect(multi.exec).toHaveBeenCalled()
    })

    it('should delete primary cache key even when tracking set is empty', async () => {
      redis.sMembers.mockResolvedValue([])

      await service.invalidateUser(mockUser.id)

      expect(multi.del).toHaveBeenCalledWith(userKey)
      expect(multi.del).toHaveBeenCalledWith(tagKey)
      expect(multi.exec).toHaveBeenCalled()
    })
  })

  describe('invalidateUsers', () => {
    it('should invalidate multiple users in batch', async () => {
      const userIds = ['user-1', 'user-2', 'user-3']
      redis.sMembers.mockResolvedValue([])

      await service.invalidateUsers(userIds)

      expect(redis.sMembers).toHaveBeenCalledTimes(3)
      for (const id of userIds) {
        expect(redis.sMembers).toHaveBeenCalledWith(`auth:user:v2:${id}:keys`)
      }
    })
  })

  describe('getMetrics', () => {
    it('should return correct metrics', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ kind: 'hit', user: mockUser }))

      await service.getUser(mockUser.id)
      await service.getUser(mockUser.id)
      await service.getUser(mockUser.id)

      const metrics = service.getMetrics()

      expect(metrics.hits).toBe(3)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
      expect(metrics.total).toBe(3)
      expect(metrics.hitRate).toBe('100.00%')
    })

    it('should calculate hit rate correctly with mixed hits and misses', async () => {
      redis.get
        .mockResolvedValueOnce(JSON.stringify({ kind: 'hit', user: mockUser }))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
      lock.acquire.mockResolvedValueOnce('lock-token')
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      await service.getUser(mockUser.id)
      await service.getUser('user-2')

      const metrics = service.getMetrics()

      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)
      expect(metrics.dbQueries).toBe(1)
      expect(metrics.total).toBe(2)
      expect(metrics.hitRate).toBe('50.00%')
    })
  })

  describe('resetMetrics', () => {
    it('should reset all metrics to zero', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ kind: 'hit', user: mockUser }))
      await service.getUser(mockUser.id)

      service.resetMetrics()
      const metrics = service.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
      expect(metrics.total).toBe(0)
    })
  })
})
