import { SystemRole } from '@prisma/client'
import type { Cache } from 'cache-manager'

import { NotFoundException } from '../../common/exceptions'
import { createMockContext, type MockContext, mockContextToPrisma } from '../auth/test-context'

import { ApiKeysService } from './api-keys.service'

describe('ApiKeysService', () => {
  let service: ApiKeysService
  let mockCtx: MockContext
  let mockCache: jest.Mocked<Pick<Cache, 'get' | 'set' | 'del'>>

  const mockApiKey = {
    id: 'key-1',
    name: 'Test Key',
    shortToken: 'abc12345',
    keyHash: 'a'.repeat(64),
    salt: 'somesalt',
    scopes: ['workout:read'],
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2024-01-01'),
    userId: 'user-1',
  }

  const mockApiKeyWithUser = {
    ...mockApiKey,
    user: { systemRole: SystemRole.USER },
  }

  beforeEach(() => {
    mockCtx = createMockContext()

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<Cache, 'get' | 'set' | 'del'>>

    const prisma = mockContextToPrisma(mockCtx)
    service = new ApiKeysService(prisma, mockCache as unknown as Cache)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('create', () => {
    it('should store shortToken in plaintext and keyHash as sha256', async () => {
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      await service.create('user-1', { name: 'Test Key', scopes: ['workout:read'] })

      const createCall = mockCtx.prisma.apiKey.create.mock.calls[0]![0]!

      expect(createCall.data.shortToken).toBeDefined()
      expect(createCall.data.keyHash).toBeDefined()
      expect(createCall.data.keyHash).toHaveLength(64) // sha256 hex is 64 chars
    })

    it('should return full key in response but not store it in db', async () => {
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      const result = await service.create('user-1', { name: 'Test Key', scopes: ['workout:read'] })

      expect(result.key).toMatch(/^amcore_live_/)
      const createCall = mockCtx.prisma.apiKey.create.mock.calls[0]![0]!
      expect(createCall.data).not.toHaveProperty('key')
    })
  })

  describe('findAllForUser', () => {
    it('should return list without secret fields', async () => {
      mockCtx.prisma.apiKey.findMany.mockResolvedValue([mockApiKey])

      const result = await service.findAllForUser('user-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('key-1')
      expect(result[0]).not.toHaveProperty('keyHash')
      expect(result[0]).not.toHaveProperty('salt')
      expect(result[0]).not.toHaveProperty('shortToken')
    })
  })

  describe('revoke', () => {
    it('should delete when id and userId match', async () => {
      mockCtx.prisma.apiKey.deleteMany.mockResolvedValue({ count: 1 })

      await expect(service.revoke('key-1', 'user-1')).resolves.not.toThrow()

      expect(mockCtx.prisma.apiKey.deleteMany).toHaveBeenCalledWith({
        where: { id: 'key-1', userId: 'user-1' },
      })
    })

    it('should throw NotFoundException when not found or not owned by user', async () => {
      mockCtx.prisma.apiKey.deleteMany.mockResolvedValue({ count: 0 })

      await expect(service.revoke('key-1', 'wrong-user')).rejects.toThrow(NotFoundException)
    })
  })

  describe('verifyByShortToken', () => {
    it('should return apiKey for valid token', async () => {
      jest.spyOn(service as any, 'verifyLongToken').mockReturnValue(true)
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue(mockApiKeyWithUser)

      const result = await service.verifyByShortToken('abc12345', 'anyToken')

      expect(result).toEqual(mockApiKeyWithUser)
    })

    it('should return null if key not found', async () => {
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue(null)

      const result = await service.verifyByShortToken('unknown', 'token')

      expect(result).toBeNull()
    })

    it('should return null if key is expired', async () => {
      const expiredKey = { ...mockApiKeyWithUser, expiresAt: new Date('2020-01-01') }
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue(expiredKey)

      const result = await service.verifyByShortToken('abc12345', 'token')

      expect(result).toBeNull()
    })

    it('should return null if longToken hash does not match', async () => {
      jest.spyOn(service as any, 'verifyLongToken').mockReturnValue(false)
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue(mockApiKeyWithUser)

      const result = await service.verifyByShortToken('abc12345', 'wrong-token')

      expect(result).toBeNull()
    })
  })

  describe('touchLastUsed', () => {
    it('should skip db update if Redis gate is already set', async () => {
      mockCache.get.mockResolvedValue('1')

      await service.touchLastUsed('key-1')

      expect(mockCtx.prisma.apiKey.update).not.toHaveBeenCalled()
    })

    it('should update db and set Redis gate on cache miss', async () => {
      mockCache.get.mockResolvedValue(null)
      mockCtx.prisma.apiKey.update.mockResolvedValue(mockApiKey)

      await service.touchLastUsed('key-1')

      await new Promise((resolve) => setImmediate(resolve))

      expect(mockCtx.prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { lastUsedAt: expect.any(Date) },
      })
      expect(mockCache.set).toHaveBeenCalledWith('api_key:last_used:key-1', '1', 3600 * 1000)
    })
  })
})
