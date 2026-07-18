import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../prisma'

import { CleanupService } from './cleanup.service'
import type { SingletonCronRunner } from './singleton-cron.runner'

import type { PrismaClient } from '@/generated/prisma/client'

describe('CleanupService', () => {
  let service: CleanupService
  let prisma: DeepMockProxy<PrismaClient>
  let singletonCron: jest.Mocked<Pick<SingletonCronRunner, 'run'>>
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    // Default: behave like the lock was won — execute the task immediately so the
    // sweep runs. The lock orchestration itself is covered in the runner's spec.
    singletonCron = {
      run: jest.fn().mockImplementation(async (_opts, task: () => Promise<void>) => {
        await task()
      }),
    } as jest.Mocked<Pick<SingletonCronRunner, 'run'>>
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new CleanupService(
      prisma as unknown as PrismaService,
      singletonCron as unknown as SingletonCronRunner,
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

  describe('scheduledCleanup (delegates to the singleton-cron runner — EQS-05)', () => {
    it('runs the sweep under the cleanup lock key/ttl and logs completion', async () => {
      zeroAll()

      await service.scheduledCleanup()

      expect(singletonCron.run).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'schedule.cleanup',
          lockKey: expect.any(String),
          ttlMs: expect.any(Number),
        }),
        expect.any(Function)
      )
      // default runner mock executes the task → the sweep ran + completion logged
      expect(prisma.session.deleteMany).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'schedule.cleanup_complete' }),
        expect.any(String)
      )
    })

    it('does not run the sweep when the runner skips the task (lock lost / Redis down)', async () => {
      // Runner did not invoke the task (skip / fail-closed paths are its own spec).
      singletonCron.run.mockResolvedValueOnce(undefined)

      await service.scheduledCleanup()

      expect(prisma.session.deleteMany).not.toHaveBeenCalled()
    })
  })
})
