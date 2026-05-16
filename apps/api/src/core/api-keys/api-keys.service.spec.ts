import { SystemRole } from '@prisma/client'
import type { Cache } from 'cache-manager'
import type { PinoLogger } from 'nestjs-pino'

import { ForbiddenException, NotFoundException } from '../../common/exceptions'
import { createMockContext, type MockContext, mockContextToPrisma } from '../auth/test-context'

import { ApiKeysService } from './api-keys.service'

describe('ApiKeysService', () => {
  let service: ApiKeysService
  let mockCtx: MockContext
  let mockCache: jest.Mocked<Pick<Cache, 'get' | 'set' | 'del'>>
  let mockLogger: jest.Mocked<PinoLogger>

  const mockApiKey = {
    id: 'key-1',
    name: 'Test Key',
    shortToken: 'abc12345',
    keyHash: 'a'.repeat(64),
    salt: 'somesalt',
    scopes: ['read:User'],
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2024-01-01'),
    userId: 'user-1',
    organizationId: 'org-1',
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

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    const prisma = mockContextToPrisma(mockCtx)
    service = new ApiKeysService(prisma, mockCache as unknown as Cache, mockLogger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('create', () => {
    const validInput = {
      name: 'Test Key',
      organizationId: 'org-1',
      scopes: ['read:User'],
    }

    function mockMembership(found: boolean) {
      mockCtx.prisma.orgMember.findUnique.mockResolvedValue(
        found ? ({ id: 'member-1' } as never) : null
      )
    }

    it('should store shortToken in plaintext and keyHash as sha256', async () => {
      mockMembership(true)
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      await service.create('user-1', validInput)

      const createCall = mockCtx.prisma.apiKey.create.mock.calls[0]![0]!

      expect(createCall.data.shortToken).toBeDefined()
      expect(createCall.data.keyHash).toBeDefined()
      expect(createCall.data.keyHash).toHaveLength(64) // sha256 hex is 64 chars
    })

    it('should return full key in response but not store it in db', async () => {
      mockMembership(true)
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      const result = await service.create('user-1', validInput)

      expect(result.key).toMatch(/^amcore_live_/)
      const createCall = mockCtx.prisma.apiKey.create.mock.calls[0]![0]!
      expect(createCall.data).not.toHaveProperty('key')
    })

    // AK-04 / ADR-033: API keys are organization-scoped credentials.
    it('persists organizationId on the new key', async () => {
      mockMembership(true)
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      const result = await service.create('user-1', validInput)

      const createCall = mockCtx.prisma.apiKey.create.mock.calls[0]![0]!
      expect(createCall.data.organizationId).toBe('org-1')
      expect(result.organizationId).toBe('org-1')
    })

    // AK-04 / ADR-033: creator must be a member of the bound organization.
    it('throws ForbiddenException when creator is not a member of the organization', async () => {
      mockMembership(false)

      await expect(service.create('user-1', validInput)).rejects.toThrow(ForbiddenException)
      expect(mockCtx.prisma.apiKey.create).not.toHaveBeenCalled()
    })

    it('looks up membership by composite (userId, organizationId) key', async () => {
      mockMembership(true)
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)

      await service.create('user-1', validInput)

      expect(mockCtx.prisma.orgMember.findUnique).toHaveBeenCalledWith({
        where: { userId_organizationId: { userId: 'user-1', organizationId: 'org-1' } },
        select: { id: true },
      })
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

    // AK-12: cache I/O must not propagate. The caller does `void
    // touchLastUsed(...)` — any uncaught error becomes an unhandled
    // rejection. Each cache op is wrapped; a flaky Redis only ever
    // produces a warn log, never breaks an authenticated request.
    describe('AK-12: best-effort cache I/O', () => {
      it('cache.get rejection → no throw, warn logged, db update still fires', async () => {
        mockCache.get.mockRejectedValueOnce(new Error('Redis ECONNRESET'))
        mockCtx.prisma.apiKey.update.mockResolvedValue(mockApiKey)

        await expect(service.touchLastUsed('key-1')).resolves.toBeUndefined()
        await new Promise((resolve) => setImmediate(resolve))

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ apiKeyId: 'key-1' }),
          expect.stringContaining('Failed to read api_key last_used cache gate')
        )
        // Falls through to the DB update — we don't know if it was a
        // recent touch, so we do the extra write rather than skip silently.
        expect(mockCtx.prisma.apiKey.update).toHaveBeenCalled()
      })

      it('cache.set rejection → no throw, warn logged', async () => {
        mockCache.get.mockResolvedValue(null)
        mockCache.set.mockRejectedValueOnce(new Error('Redis OOM'))
        mockCtx.prisma.apiKey.update.mockResolvedValue(mockApiKey)

        await expect(service.touchLastUsed('key-1')).resolves.toBeUndefined()
        await new Promise((resolve) => setImmediate(resolve))

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ apiKeyId: 'key-1' }),
          expect.stringContaining('Failed to set api_key last_used cache gate')
        )
      })

      it('both cache ops reject → method completes, two warns', async () => {
        mockCache.get.mockRejectedValueOnce(new Error('get failed'))
        mockCache.set.mockRejectedValueOnce(new Error('set failed'))
        mockCtx.prisma.apiKey.update.mockResolvedValue(mockApiKey)

        await expect(service.touchLastUsed('key-1')).resolves.toBeUndefined()
        await new Promise((resolve) => setImmediate(resolve))

        const warnMessages = mockLogger.warn.mock.calls.map(([, msg]) => msg)
        expect(warnMessages).toEqual(
          expect.arrayContaining([
            expect.stringContaining('Failed to read api_key last_used cache gate'),
            expect.stringContaining('Failed to set api_key last_used cache gate'),
          ])
        )
      })

      // Raw key material (shortToken / longToken / hash / salt) must never
      // appear in any log emitted by this method.
      it('warn payloads never contain raw key material', async () => {
        mockCache.get.mockRejectedValueOnce(new Error('boom'))
        mockCache.set.mockRejectedValueOnce(new Error('boom'))
        mockCtx.prisma.apiKey.update.mockResolvedValue(mockApiKey)

        await service.touchLastUsed('key-1')
        await new Promise((resolve) => setImmediate(resolve))

        for (const [payload] of mockLogger.warn.mock.calls) {
          const obj = payload as Record<string, unknown>
          expect(obj).not.toHaveProperty('shortToken')
          expect(obj).not.toHaveProperty('longToken')
          expect(obj).not.toHaveProperty('keyHash')
          expect(obj).not.toHaveProperty('salt')
        }
      })
    })
  })
})
