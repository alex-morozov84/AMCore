import type { EmailVerificationToken, PasswordResetToken } from '@prisma/client'

import { AppException } from '../../common/exceptions'
import type { EnvService } from '../../env/env.service'

import { createMockContext, type MockContext, mockContextToPrisma } from './test-context'
import { TokenManagerService } from './token-manager.service'

describe('TokenManagerService', () => {
  let service: TokenManagerService
  let mockCtx: MockContext
  let envService: jest.Mocked<Pick<EnvService, 'get'>>

  const userId = 'user-123'

  const mockResetToken: PasswordResetToken = {
    id: 'token-123',
    userId,
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min future
    used: false,
    usedAt: null,
    createdAt: new Date(),
  }

  const mockVerificationToken: EmailVerificationToken = {
    id: 'token-456',
    userId,
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h future
    used: false,
    usedAt: null,
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockCtx = createMockContext()

    envService = {
      get: jest.fn((key: string) => {
        if (key === 'PASSWORD_RESET_EXPIRY_MINUTES') return 15
        if (key === 'EMAIL_VERIFICATION_EXPIRY_HOURS') return 48
        return undefined
      }) as jest.MockedFunction<EnvService['get']>,
    }

    service = new TokenManagerService(
      mockContextToPrisma(mockCtx),
      envService as unknown as EnvService
    )
  })

  // ==========================================
  // Password Reset Token
  // ==========================================

  describe('generatePasswordResetToken()', () => {
    it('should invalidate previous tokens and generate a new one', async () => {
      mockCtx.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 })
      mockCtx.prisma.passwordResetToken.create.mockResolvedValue(mockResetToken)

      const result = await service.generatePasswordResetToken(userId)

      expect(result.token).toHaveLength(64)
      expect(result.expiresAt).toBeInstanceOf(Date)
      expect(mockCtx.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId, used: false },
        data: { used: true },
      })
      expect(mockCtx.prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId }),
      })
    })

    it('should set expiry to PASSWORD_RESET_EXPIRY_MINUTES from now', async () => {
      mockCtx.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 })
      mockCtx.prisma.passwordResetToken.create.mockResolvedValue(mockResetToken)

      const before = Date.now()
      const result = await service.generatePasswordResetToken(userId)
      const after = Date.now()

      const expectedExpiry = before + 15 * 60 * 1000
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 1000)
    })
  })

  describe('verifyPasswordResetToken()', () => {
    it('should return userId and tokenHash for a valid token', async () => {
      mockCtx.prisma.passwordResetToken.findUnique.mockResolvedValue(mockResetToken)

      const result = await service.verifyPasswordResetToken('a'.repeat(64))

      expect(result.userId).toBe(userId)
      expect(result.tokenHash).toHaveLength(64) // SHA-256 hex
    })

    it('should throw if token not found', async () => {
      mockCtx.prisma.passwordResetToken.findUnique.mockResolvedValue(null)

      await expect(service.verifyPasswordResetToken('invalid')).rejects.toThrow(AppException)
    })

    it('should throw if token is already used', async () => {
      mockCtx.prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...mockResetToken,
        used: true,
      })

      await expect(service.verifyPasswordResetToken('a'.repeat(64))).rejects.toThrow(AppException)
    })

    it('should throw if token is expired', async () => {
      mockCtx.prisma.passwordResetToken.findUnique.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date(Date.now() - 1000), // 1 second in the past
      })

      await expect(service.verifyPasswordResetToken('a'.repeat(64))).rejects.toThrow(AppException)
    })
  })

  describe('consumePasswordResetToken()', () => {
    it('should mark token as used', async () => {
      mockCtx.prisma.passwordResetToken.update.mockResolvedValue({
        ...mockResetToken,
        used: true,
      })

      await service.consumePasswordResetToken('a'.repeat(64))

      expect(mockCtx.prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: expect.objectContaining({ tokenHash: expect.any(String) }),
        data: { used: true, usedAt: expect.any(Date) },
      })
    })
  })

  // ==========================================
  // Email Verification Token
  // ==========================================

  describe('generateEmailVerificationToken()', () => {
    it('should invalidate previous tokens and generate a new one', async () => {
      mockCtx.prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })
      mockCtx.prisma.emailVerificationToken.create.mockResolvedValue(mockVerificationToken)

      const result = await service.generateEmailVerificationToken(userId)

      expect(result.token).toHaveLength(64)
      expect(result.expiresAt).toBeInstanceOf(Date)
      expect(mockCtx.prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId, used: false },
        data: { used: true },
      })
    })

    it('should set expiry to EMAIL_VERIFICATION_EXPIRY_HOURS from now', async () => {
      mockCtx.prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 })
      mockCtx.prisma.emailVerificationToken.create.mockResolvedValue(mockVerificationToken)

      const before = Date.now()
      const result = await service.generateEmailVerificationToken(userId)

      const expectedExpiry = before + 48 * 60 * 60 * 1000
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000)
    })
  })

  describe('verifyEmailVerificationToken()', () => {
    it('should return userId and tokenHash for a valid token', async () => {
      mockCtx.prisma.emailVerificationToken.findUnique.mockResolvedValue(mockVerificationToken)

      const result = await service.verifyEmailVerificationToken('a'.repeat(64))

      expect(result.userId).toBe(userId)
      expect(result.tokenHash).toHaveLength(64) // SHA-256 hex
    })

    it('should throw if token not found', async () => {
      mockCtx.prisma.emailVerificationToken.findUnique.mockResolvedValue(null)

      await expect(service.verifyEmailVerificationToken('invalid')).rejects.toThrow(AppException)
    })

    it('should throw if token is used', async () => {
      mockCtx.prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...mockVerificationToken,
        used: true,
      })

      await expect(service.verifyEmailVerificationToken('a'.repeat(64))).rejects.toThrow(
        AppException
      )
    })

    it('should throw if token is expired', async () => {
      mockCtx.prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...mockVerificationToken,
        expiresAt: new Date(Date.now() - 1000),
      })

      await expect(service.verifyEmailVerificationToken('a'.repeat(64))).rejects.toThrow(
        AppException
      )
    })
  })

  describe('consumeEmailVerificationToken()', () => {
    it('should mark token as used', async () => {
      mockCtx.prisma.emailVerificationToken.update.mockResolvedValue({
        ...mockVerificationToken,
        used: true,
      })

      await service.consumeEmailVerificationToken('a'.repeat(64))

      expect(mockCtx.prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: expect.objectContaining({ tokenHash: expect.any(String) }),
        data: { used: true, usedAt: expect.any(Date) },
      })
    })
  })

  // ==========================================
  // invalidateUserTokens()
  // ==========================================

  describe('invalidateUserTokens()', () => {
    it('should invalidate password reset tokens', async () => {
      mockCtx.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 2 })

      await service.invalidateUserTokens(userId, 'password-reset')

      expect(mockCtx.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId, used: false },
        data: { used: true },
      })
    })

    it('should invalidate email verification tokens', async () => {
      mockCtx.prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })

      await service.invalidateUserTokens(userId, 'email-verification')

      expect(mockCtx.prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId, used: false },
        data: { used: true },
      })
    })
  })
})
