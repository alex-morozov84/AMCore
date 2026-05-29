import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../prisma'

import { CleanupService } from './cleanup.service'

describe('CleanupService', () => {
  let service: CleanupService
  let prisma: DeepMockProxy<PrismaClient>
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new CleanupService(prisma as unknown as PrismaService, mockLogger)
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
      })
    })
  })
})
