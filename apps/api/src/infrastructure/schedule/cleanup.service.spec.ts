import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { RedisLockService } from '../../infrastructure/redis'
import type { PrismaService } from '../../prisma'

import { CleanupService } from './cleanup.service'

describe('CleanupService', () => {
  let service: CleanupService
  let prisma: DeepMockProxy<PrismaClient>
  let lock: jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    lock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<Pick<RedisLockService, 'acquire' | 'release'>>
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new CleanupService(
      prisma as unknown as PrismaService,
      lock as unknown as RedisLockService,
      mockLogger
    )
  })

  // Default all deleteMany mocks to zero so each test only sets what it asserts.
  const zeroAll = (): void => {
    prisma.session.deleteMany.mockResolvedValue({ count: 0 })
    prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 })
    prisma.apiKey.deleteMany.mockResolvedValue({ count: 0 })
    prisma.orgInvite.deleteMany.mockResolvedValue({ count: 0 })
  }

  describe('runCleanup', () => {
    it('deletes all five types of expired records and returns counts', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 5 })
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 3 })
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 7 })
      prisma.apiKey.deleteMany.mockResolvedValue({ count: 2 })
      prisma.orgInvite.deleteMany
        .mockResolvedValueOnce({ count: 4 }) // expired pending
        .mockResolvedValueOnce({ count: 1 }) // stale terminal

      const result = await service.runCleanup()

      expect(result).toEqual({
        expiredSessions: 5,
        expiredPasswordResetTokens: 3,
        expiredEmailVerificationTokens: 7,
        expiredApiKeys: 2,
        expiredPendingInvites: 4,
        staleTerminalInvites: 1,
        failures: [],
      })
    })

    it('deletes expired-pending and stale-terminal invites with the right where-clauses', async () => {
      zeroAll()

      await service.runCleanup()

      expect(prisma.orgInvite.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) }, acceptedAt: null, revokedAt: null },
      })
      expect(prisma.orgInvite.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [{ acceptedAt: { lt: expect.any(Date) } }, { revokedAt: { lt: expect.any(Date) } }],
        },
      })
    })

    it('runs the token/key deletions in parallel', async () => {
      zeroAll()

      await service.runCleanup()

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      })
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      })
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      })
      expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      })
    })

    it('returns zero counts when nothing to clean up', async () => {
      zeroAll()

      const result = await service.runCleanup()

      expect(result).toEqual({
        expiredSessions: 0,
        expiredPasswordResetTokens: 0,
        expiredEmailVerificationTokens: 0,
        expiredApiKeys: 0,
        expiredPendingInvites: 0,
        staleTerminalInvites: 0,
        failures: [],
      })
    })

    it('isolates a per-type failure: keeps the other counts, records it in failures, does not throw (EQS-04)', async () => {
      zeroAll()
      prisma.session.deleteMany.mockResolvedValue({ count: 9 })
      prisma.apiKey.deleteMany.mockRejectedValue(new Error('pool timeout'))

      const result = await service.runCleanup()

      expect(result.expiredSessions).toBe(9)
      expect(result.expiredApiKeys).toBe(0)
      expect(result.failures).toEqual(['expiredApiKeys'])
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'schedule.cleanup_partial_failure',
          recordType: 'expiredApiKeys',
        }),
        expect.any(String)
      )
    })

    it('returns a structured result (not a throw) even when every task fails (EQS-04)', async () => {
      prisma.session.deleteMany.mockRejectedValue(new Error('x'))
      prisma.passwordResetToken.deleteMany.mockRejectedValue(new Error('x'))
      prisma.emailVerificationToken.deleteMany.mockRejectedValue(new Error('x'))
      prisma.apiKey.deleteMany.mockRejectedValue(new Error('x'))
      prisma.orgInvite.deleteMany.mockRejectedValue(new Error('x'))

      const result = await service.runCleanup()

      expect(result.failures).toHaveLength(6)
      expect(result.expiredSessions).toBe(0)
    })
  })

  describe('scheduledCleanup (distributed lock — EQS-05)', () => {
    it('runs the sweep and releases the lock when acquired', async () => {
      zeroAll()
      lock.acquire.mockResolvedValue('lock-token')

      await service.scheduledCleanup()

      expect(lock.acquire).toHaveBeenCalledTimes(1)
      expect(prisma.session.deleteMany).toHaveBeenCalled()
      expect(lock.release).toHaveBeenCalledWith(expect.any(String), 'lock-token')
    })

    it('skips the sweep (no run, no release) when the lock is held by another instance', async () => {
      lock.acquire.mockResolvedValue(null)

      await service.scheduledCleanup()

      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
      expect(lock.release).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'schedule.cleanup_skipped' }),
        expect.any(String)
      )
    })

    it('releases the lock and logs a stable event if the run throws unexpectedly', async () => {
      lock.acquire.mockResolvedValue('lock-token')
      jest.spyOn(service, 'runCleanup').mockRejectedValue(new Error('boom'))

      await expect(service.scheduledCleanup()).resolves.toBeUndefined()

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'schedule.cleanup_failed' }),
        expect.any(String)
      )
      expect(lock.release).toHaveBeenCalledWith(expect.any(String), 'lock-token')
    })

    it('fails closed when lock acquisition throws (no run, no rejection)', async () => {
      zeroAll()
      lock.acquire.mockRejectedValue(new Error('redis down'))

      await expect(service.scheduledCleanup()).resolves.toBeUndefined()

      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
      expect(lock.release).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'schedule.cleanup_lock_failed' }),
        expect.any(String)
      )
    })

    it('swallows a lock-release failure (logs stable event, no rejection)', async () => {
      zeroAll()
      lock.acquire.mockResolvedValue('lock-token')
      lock.release.mockRejectedValue(new Error('release failed'))

      await expect(service.scheduledCleanup()).resolves.toBeUndefined()

      expect(prisma.session.deleteMany).toHaveBeenCalled() // run still happened
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'schedule.cleanup_lock_release_failed' }),
        expect.any(String)
      )
    })
  })
})
