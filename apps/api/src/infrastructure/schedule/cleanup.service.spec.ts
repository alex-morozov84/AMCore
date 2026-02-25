import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { PrismaService } from '../../prisma'

import { CleanupService } from './cleanup.service'

describe('CleanupService', () => {
  let service: CleanupService
  let prisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new CleanupService(prisma as unknown as PrismaService)
  })

  describe('runCleanup', () => {
    it('deletes all four types of expired records and returns counts', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 5 })
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 3 })
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 7 })
      prisma.apiKey.deleteMany.mockResolvedValue({ count: 2 })

      const result = await service.runCleanup()

      expect(result).toEqual({
        expiredSessions: 5,
        expiredPasswordResetTokens: 3,
        expiredEmailVerificationTokens: 7,
        expiredApiKeys: 2,
      })
    })

    it('runs all four deletions in parallel', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 0 })
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 })
      prisma.apiKey.deleteMany.mockResolvedValue({ count: 0 })

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
      prisma.session.deleteMany.mockResolvedValue({ count: 0 })
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 })
      prisma.apiKey.deleteMany.mockResolvedValue({ count: 0 })

      const result = await service.runCleanup()

      expect(result).toEqual({
        expiredSessions: 0,
        expiredPasswordResetTokens: 0,
        expiredEmailVerificationTokens: 0,
        expiredApiKeys: 0,
      })
    })
  })
})
