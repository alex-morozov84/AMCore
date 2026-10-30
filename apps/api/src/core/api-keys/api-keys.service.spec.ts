import type { PinoLogger } from 'nestjs-pino'

import { ForbiddenException, NotFoundException } from '../../common/exceptions'
import type { BoundedRedis } from '../../infrastructure/redis'
import type { AuditLogService } from '../audit'
import {
  createMockContext,
  type MockContext,
  mockContextToPrisma,
} from '../auth/auth-context.testkit'
import { AUTH_STAGE_MS, AuthStageService } from '../auth/stage/auth-stage.service'

import type { ApiKeyRevocationService } from './api-key-revocation.service'
import { ApiKeysService } from './api-keys.service'

import { SystemRole } from '@/generated/prisma/client'

describe('ApiKeysService', () => {
  let service: ApiKeysService
  let mockCtx: MockContext
  let redisSet: jest.Mock
  let mockRedis: { run: jest.Mock }
  let mockAuditLog: jest.Mocked<Pick<AuditLogService, 'record'>>
  const mockRevocation = { revoke: jest.fn() }
  let mockLogger: jest.Mocked<PinoLogger>

  const mockApiKey = {
    id: 'key-1',
    name: 'Test Key',
    shortToken: 'abc12345',
    keyHash: 'a'.repeat(64),
    salt: 'somesalt',
    scopes: ['read:User'],
    expiresAt: null,
    revokedAt: null,
    revokedByUserId: null,
    revocationReason: null,
    lastUsedAt: null,
    createdAt: new Date('2024-01-01'),
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { name: 'Current organization', members: [{ id: 'member-1' }] },
  }

  const mockApiKeyWithUser = {
    ...mockApiKey,
    user: { systemRole: SystemRole.USER },
  }

  beforeEach(() => {
    mockCtx = createMockContext()

    redisSet = jest.fn().mockResolvedValue('OK')
    mockRedis = {
      run: jest.fn((operation: (client: { set: jest.Mock }) => Promise<unknown>) =>
        operation({ set: redisSet })
      ),
    }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    mockAuditLog = { record: jest.fn().mockResolvedValue(undefined) }

    const prisma = mockContextToPrisma(mockCtx)
    service = new ApiKeysService(
      prisma,
      mockRedis as unknown as BoundedRedis,
      mockAuditLog as unknown as AuditLogService,
      mockLogger,
      mockRevocation as unknown as ApiKeyRevocationService
    )
    ;(mockCtx.prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (cb: (tx: typeof mockCtx.prisma) => Promise<unknown>) => cb(mockCtx.prisma)
    )
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
      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'api_key.created',
          organizationId: 'org-1',
          targetId: 'key-1',
        }),
        expect.objectContaining({ tx: mockCtx.prisma })
      )
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

    it('fails closed when transactional audit insert fails', async () => {
      mockMembership(true)
      mockCtx.prisma.apiKey.create.mockResolvedValue(mockApiKey)
      mockAuditLog.record.mockRejectedValueOnce(new Error('audit down'))

      await expect(service.create('user-1', validInput)).rejects.toThrow('audit down')
    })
  })

  describe('findAllForUser', () => {
    it('returns paginated envelope without secret fields (OB-05)', async () => {
      mockCtx.prisma.apiKey.findMany.mockResolvedValue([mockApiKey])
      mockCtx.prisma.apiKey.count.mockResolvedValue(1)

      const result = await service.findAllForUser('user-1', 1, 20)

      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.id).toBe('key-1')
      expect(result.data[0]).not.toHaveProperty('keyHash')
      expect(result.data[0]).not.toHaveProperty('salt')
      expect(result.data[0]).not.toHaveProperty('shortToken')
    })

    it('applies skip/take and `createdAt DESC, id ASC` order (ADR-036)', async () => {
      mockCtx.prisma.apiKey.findMany.mockResolvedValue([])
      mockCtx.prisma.apiKey.count.mockResolvedValue(0)

      await service.findAllForUser('user-1', 2, 10)

      const arg = mockCtx.prisma.apiKey.findMany.mock.calls[0]![0]!
      expect(arg.skip).toBe(10)
      expect(arg.take).toBe(10)
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }])
    })
  })

  describe('revoke', () => {
    it('delegates own irreversible transition to the shared service', async () => {
      mockRevocation.revoke.mockResolvedValue({ requestedCount: 1, affectedCount: 1 })
      await service.revoke('key-1', 'user-1')
      expect(mockRevocation.revoke).toHaveBeenCalledWith(['key-1'], 'user-1', false)
      expect(mockCtx.prisma.apiKey.deleteMany).not.toHaveBeenCalled()
    })
    it('propagates foreign/missing-key404', async () => {
      mockRevocation.revoke.mockRejectedValue(new NotFoundException('API key'))
      await expect(service.revoke('key-1', 'wrong-user')).rejects.toThrow(NotFoundException)
    })
  })

  describe('verifyByShortToken', () => {
    it('reads safe owner metadata in a repeatable snapshot and hides former organization names', async () => {
      mockCtx.prisma.apiKey.findMany.mockResolvedValue([
        mockApiKey,
        {
          ...mockApiKey,
          id: 'former-key',
          organization: { name: 'Private renamed organization', members: [] },
        },
      ] as never)
      mockCtx.prisma.apiKey.count.mockResolvedValue(2)
      const result = await service.findAllForUser('user-1', 1, 20, 'all')
      expect(result.data.map((key) => key.organizationName)).toEqual(['Current organization', null])
      expect(JSON.stringify(result)).not.toContain('Private renamed organization')
      expect(mockCtx.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'RepeatableRead',
      })
      const query = mockCtx.prisma.apiKey.findMany.mock.calls[0]![0]!
      expect(query.where).toEqual({ userId: 'user-1' })
      expect(query.select).not.toHaveProperty('keyHash')
      expect(query.select).not.toHaveProperty('salt')
      expect(query.select?.organization).toEqual({
        select: {
          name: true,
          members: { where: { userId: 'user-1' }, take: 1, select: { id: true } },
        },
      })
    })

    it('should return apiKey for valid token', async () => {
      jest.spyOn(service as any, 'verifyLongToken').mockReturnValue(true)
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue(mockApiKeyWithUser)

      const result = await service.verifyByShortToken('abc12345', 'anyToken')

      expect(result).toEqual(mockApiKeyWithUser)
    })

    it.each([
      { revokedAt: new Date(), keyHash: null, salt: null },
      { revokedAt: null, keyHash: null },
      { revokedAt: null, salt: null },
    ])('rejects terminal/incomplete verifier before hashing: %j', async (state) => {
      const hash = jest.spyOn(service as any, 'verifyLongToken').mockReturnValue(true)
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKeyWithUser,
        ...state,
      } as never)
      expect(await service.verifyByShortToken('abc', 'token')).toBeNull()
      expect(hash).not.toHaveBeenCalled()
    })
    it('rejects expiry equality before hashing', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T08:00:00Z'))
      const hash = jest.spyOn(service as any, 'verifyLongToken').mockReturnValue(true)
      mockCtx.prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKeyWithUser,
        expiresAt: new Date(),
      } as never)
      try {
        expect(await service.verifyByShortToken('abc', 'token')).toBeNull()
        expect(hash).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
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

  describe('touchLastUsed inside an admission stage (T082)', () => {
    afterEach(() => jest.useRealTimers())

    // The real method runs with its claim held; the stage expires; only then is the claim released.
    const startUnderStage = async (): Promise<{
      settleClaim: (outcome: 'ok' | 'fail') => void
      detached: Promise<void>
      unhandled: unknown[]
      stopListening: () => void
    }> => {
      jest.useFakeTimers()
      let settleClaim!: (outcome: 'ok' | 'fail') => void
      mockRedis.run.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settleClaim = (outcome) =>
              outcome === 'ok' ? resolve('OK') : reject(new Error('Redis ECONNRESET'))
          })
      )
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): number => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      let detached!: Promise<void>
      const stage = new AuthStageService()
      const outcome = stage
        .run(async () => {
          // Mirrors the guard: the detached promise inherits the stage context.
          detached = service.touchLastUsed('key-1')
          await new Promise(() => undefined)
        })
        .catch(() => undefined)
      await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
      await outcome
      // The listener stays on until the scenario ends, so a rejection raised AFTER the late
      // claim settles is also seen.
      return {
        settleClaim,
        detached,
        unhandled,
        stopListening: () => process.off('unhandledRejection', onUnhandled),
      }
    }

    it.each(['ok', 'fail'] as const)(
      'starts no database write when the claim settles (%s) after the stage expired',
      async (outcome) => {
        const { settleClaim, detached, unhandled, stopListening } = await startUnderStage()
        try {
          settleClaim(outcome)
          await detached
          await jest.advanceTimersByTimeAsync(0)
          // Let a late unhandled-rejection event, if any, reach the listener before asserting.
          jest.useRealTimers()
          await new Promise((resolve) => setImmediate(resolve))
          expect(mockCtx.prisma.apiKey.updateMany).not.toHaveBeenCalled()
          expect(unhandled).toEqual([])
        } finally {
          stopListening()
        }
      }
    )

    it('still writes when the claim settles inside the stage budget', async () => {
      mockCtx.prisma.apiKey.updateMany.mockResolvedValue({ count: 1 })
      await new AuthStageService().run(async () => {
        await service.touchLastUsed('key-1')
      })
      await new Promise((resolve) => setImmediate(resolve))
      expect(mockCtx.prisma.apiKey.updateMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('touchLastUsed', () => {
    it('should skip db update if another caller already holds the Redis claim', async () => {
      redisSet.mockResolvedValue(null)

      await service.touchLastUsed('key-1')

      expect(mockCtx.prisma.apiKey.updateMany).not.toHaveBeenCalled()
    })

    it('should claim the hourly gate atomically and update db when the claim succeeds', async () => {
      redisSet.mockResolvedValue('OK')
      mockCtx.prisma.apiKey.updateMany.mockResolvedValue({ count: 1 })

      await service.touchLastUsed('key-1')

      await new Promise((resolve) => setImmediate(resolve))

      expect(mockCtx.prisma.apiKey.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'key-1',
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        data: { lastUsedAt: expect.any(Date) },
      })
      expect(redisSet).toHaveBeenCalledTimes(1)
      expect(redisSet).toHaveBeenCalledWith('api_key:last_used:key-1', '1', {
        expiration: { type: 'PX', value: 3600 * 1000 },
        condition: 'NX',
      })
    })

    it('does not delete the claim when the db update fails (metadata stays stale up to an hour)', async () => {
      mockCtx.prisma.apiKey.updateMany.mockRejectedValue(new Error('db down'))

      await expect(service.touchLastUsed('key-1')).resolves.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))

      expect(redisSet).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to update lastUsedAt'
      )
    })

    // AK-12: Redis I/O must not propagate. The caller does `void
    // touchLastUsed(...)` — any uncaught error becomes an unhandled
    // rejection. The claim is wrapped; a flaky Redis only ever
    // produces a warn log, never breaks an authenticated request.
    describe('AK-12: best-effort Redis I/O', () => {
      it('claim rejection → no throw, warn logged, db update still fires', async () => {
        mockRedis.run.mockRejectedValueOnce(new Error('Redis ECONNRESET'))
        mockCtx.prisma.apiKey.updateMany.mockResolvedValue({ count: 1 })

        await expect(service.touchLastUsed('key-1')).resolves.toBeUndefined()
        await new Promise((resolve) => setImmediate(resolve))

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ apiKeyId: 'key-1' }),
          expect.stringContaining('Failed to claim api_key last_used gate')
        )
        // Falls through to the DB update — we don't know if it was a
        // recent touch, so we do the extra write rather than skip silently.
        expect(mockCtx.prisma.apiKey.updateMany).toHaveBeenCalled()
      })

      // Raw key material (shortToken / longToken / hash / salt) must never
      // appear in any log emitted by this method.
      it('warn payloads never contain raw key material', async () => {
        mockRedis.run.mockRejectedValueOnce(new Error('boom'))
        mockCtx.prisma.apiKey.updateMany.mockRejectedValue(new Error('boom'))

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
