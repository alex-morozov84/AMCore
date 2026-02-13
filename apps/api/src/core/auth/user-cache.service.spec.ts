import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Test, TestingModule } from '@nestjs/testing'
import type { User } from '@prisma/client'
import type { Cache } from 'cache-manager'

import { UserCacheService } from './user-cache.service'

import { PrismaService } from '@/prisma'

describe('UserCacheService', () => {
  let service: UserCacheService
  let cache: Cache
  let prisma: PrismaService

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: true,
    passwordHash: 'hashedPassword',
    name: 'Test User',
    avatarUrl: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserCacheService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
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
      ],
    }).compile()

    service = module.get<UserCacheService>(UserCacheService)
    cache = module.get<Cache>(CACHE_MANAGER)
    prisma = module.get<PrismaService>(PrismaService)

    // Reset metrics before each test
    service.resetMetrics()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('getUser', () => {
    it('should return cached user when cache hit', async () => {
      // Arrange
      jest.spyOn(cache, 'get').mockResolvedValue(mockUser)

      // Act
      const result = await service.getUser(mockUser.id)

      // Assert
      expect(result).toEqual(mockUser)
      expect(cache.get).toHaveBeenCalledWith(`user:${mockUser.id}`)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()

      // Verify metrics
      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
    })

    it('should query database and cache result when cache miss', async () => {
      // Arrange
      jest
        .spyOn(cache, 'get')
        .mockResolvedValueOnce(undefined) // First cache check
        .mockResolvedValueOnce(undefined) // Lock check
        .mockResolvedValueOnce(undefined) // Double-check after lock

      jest.spyOn(cache, 'set').mockResolvedValue(undefined)
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      // Act
      const result = await service.getUser(mockUser.id)

      // Assert
      expect(result).toEqual(mockUser)
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      })
      expect(cache.set).toHaveBeenCalledWith(
        `user:${mockUser.id}`,
        mockUser,
        600 * 1000 // TTL
      )

      // Verify metrics
      const metrics = service.getMetrics()
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(1)
      expect(metrics.dbQueries).toBe(1)
    })

    it('should cache null result with short TTL when user not found', async () => {
      // Arrange
      jest
        .spyOn(cache, 'get')
        .mockResolvedValueOnce(undefined) // First cache check
        .mockResolvedValueOnce(undefined) // Lock check
        .mockResolvedValueOnce(undefined) // Double-check after lock

      jest.spyOn(cache, 'set').mockResolvedValue(undefined)
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null)

      // Act
      const result = await service.getUser('non-existent')

      // Assert
      expect(result).toBeNull()
      expect(cache.set).toHaveBeenCalledWith('user:non-existent', null, 60 * 1000) // 1 minute TTL
    })

    it('should wait and retry when lock is held by another request', async () => {
      // Arrange
      jest
        .spyOn(cache, 'get')
        .mockResolvedValueOnce(undefined) // First cache check - miss
        .mockResolvedValueOnce('1') // Lock check - held by another request
        .mockResolvedValueOnce(mockUser) // Retry cache check - hit

      // Act
      const result = await service.getUser(mockUser.id)

      // Assert
      expect(result).toEqual(mockUser)
      // Should not query database (another request did it)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('should track cache keys for tag-based invalidation', async () => {
      // Arrange
      jest
        .spyOn(cache, 'get')
        .mockResolvedValueOnce(undefined) // First cache check
        .mockResolvedValueOnce(undefined) // Lock check
        .mockResolvedValueOnce(undefined) // Double-check after lock
        .mockResolvedValueOnce([]) // Get tracking set (empty)

      jest.spyOn(cache, 'set').mockResolvedValue(undefined)
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      // Act
      await service.getUser(mockUser.id)

      // Assert
      // Should store tracking set with cache key
      expect(cache.set).toHaveBeenCalledWith(
        `user:${mockUser.id}:cache_keys`,
        [`user:${mockUser.id}`],
        86400 * 1000 // 24h TTL
      )
    })
  })

  describe('invalidateUser', () => {
    it('should invalidate all cache keys for a user', async () => {
      // Arrange
      const cacheKeys = [`user:${mockUser.id}`, `user:${mockUser.id}:profile`]
      jest.spyOn(cache, 'get').mockResolvedValue(cacheKeys)
      jest.spyOn(cache, 'del').mockResolvedValue(true)

      // Act
      await service.invalidateUser(mockUser.id)

      // Assert
      expect(cache.get).toHaveBeenCalledWith(`user:${mockUser.id}:cache_keys`)
      expect(cache.del).toHaveBeenCalledTimes(3) // 2 cache keys + 1 tracking set
      expect(cache.del).toHaveBeenCalledWith(cacheKeys[0])
      expect(cache.del).toHaveBeenCalledWith(cacheKeys[1])
      expect(cache.del).toHaveBeenCalledWith(`user:${mockUser.id}:cache_keys`)
    })

    it('should handle no cache keys gracefully', async () => {
      // Arrange
      jest.spyOn(cache, 'get').mockResolvedValue([])
      jest.spyOn(cache, 'del').mockResolvedValue(true)

      // Act
      await service.invalidateUser(mockUser.id)

      // Assert
      expect(cache.del).not.toHaveBeenCalled()
    })
  })

  describe('invalidateUsers', () => {
    it('should invalidate multiple users in batch', async () => {
      // Arrange
      const userIds = ['user-1', 'user-2', 'user-3']
      jest.spyOn(cache, 'get').mockResolvedValue([`user:user-1`])
      jest.spyOn(cache, 'del').mockResolvedValue(true)

      // Act
      await service.invalidateUsers(userIds)

      // Assert
      expect(cache.get).toHaveBeenCalledTimes(3)
      userIds.forEach((id) => {
        expect(cache.get).toHaveBeenCalledWith(`user:${id}:cache_keys`)
      })
    })
  })

  describe('getMetrics', () => {
    it('should return correct metrics', async () => {
      // Arrange - simulate some cache activity
      jest.spyOn(cache, 'get').mockResolvedValue(mockUser)

      // Act - generate some hits
      await service.getUser(mockUser.id)
      await service.getUser(mockUser.id)
      await service.getUser(mockUser.id)

      const metrics = service.getMetrics()

      // Assert
      expect(metrics.hits).toBe(3)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
      expect(metrics.total).toBe(3)
      expect(metrics.hitRate).toBe('100.00%')
    })

    it('should calculate hit rate correctly with mixed hits/misses', async () => {
      // Arrange
      jest
        .spyOn(cache, 'get')
        .mockResolvedValueOnce(mockUser) // Hit
        .mockResolvedValueOnce(undefined) // Miss
        .mockResolvedValueOnce(undefined) // Lock check
        .mockResolvedValueOnce(undefined) // Double-check
        .mockResolvedValueOnce([]) // Tracking set

      jest.spyOn(cache, 'set').mockResolvedValue(undefined)
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser)

      // Act
      await service.getUser(mockUser.id) // Hit
      await service.getUser('user-2') // Miss + DB query

      const metrics = service.getMetrics()

      // Assert
      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)
      expect(metrics.dbQueries).toBe(1)
      expect(metrics.total).toBe(2)
      expect(metrics.hitRate).toBe('50.00%')
    })
  })

  describe('resetMetrics', () => {
    it('should reset all metrics to zero', async () => {
      // Arrange - generate some activity
      jest.spyOn(cache, 'get').mockResolvedValue(mockUser)
      await service.getUser(mockUser.id)

      // Act
      service.resetMetrics()
      const metrics = service.getMetrics()

      // Assert
      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.dbQueries).toBe(0)
      expect(metrics.total).toBe(0)
    })
  })
})
