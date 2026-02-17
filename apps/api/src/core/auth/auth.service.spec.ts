import { ConflictException, UnauthorizedException } from '@nestjs/common'
import type { User } from '@prisma/client'
import * as argon2 from 'argon2'

import type { LoginInput, RegisterInput } from '@amcore/shared'

import { AuthService } from './auth.service'
import { SessionService } from './session.service'
import { createMockContext, type MockContext, mockContextToPrisma } from './test-context'
import { TokenService } from './token.service'
import { TokenManagerService } from './token-manager.service'
import { UserCacheService } from './user-cache.service'

// Mock email module to prevent TSX/ESM import issues (jest.mock is hoisted automatically)
jest.mock('../../infrastructure/email', () => ({ EmailService: jest.fn() }))
jest.mock('argon2')

describe('AuthService', () => {
  let authService: AuthService
  let mockCtx: MockContext
  let mockTokenService: jest.Mocked<TokenService>
  let mockTokenManager: jest.Mocked<TokenManagerService>
  let mockSessionService: jest.Mocked<SessionService>
  let mockEmailService: {
    sendPasswordResetEmail: jest.Mock
    sendPasswordChangedEmail: jest.Mock
    sendEmailVerificationEmail: jest.Mock
  }
  let mockUserCacheService: jest.Mocked<Pick<UserCacheService, 'invalidateUser'>>
  let mockEnvService: { get: jest.Mock }
  let mockCache: { get: jest.Mock; set: jest.Mock }

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: false,
    passwordHash: 'hashed-password-123',
    name: 'Test User',
    avatarUrl: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: new Date('2024-01-01'),
  }

  beforeEach(() => {
    mockCtx = createMockContext()

    mockTokenService = {
      generateAccessToken: jest.fn(),
      verifyAccessToken: jest.fn(),
      generateRefreshToken: jest.fn(),
      hashRefreshToken: jest.fn(),
      getRefreshTokenExpiration: jest.fn(),
    } as unknown as jest.Mocked<TokenService>

    mockTokenManager = {
      generatePasswordResetToken: jest.fn(),
      verifyPasswordResetToken: jest.fn(),
      generateEmailVerificationToken: jest.fn(),
      verifyEmailVerificationToken: jest.fn(),
      consumePasswordResetToken: jest.fn(),
      consumeEmailVerificationToken: jest.fn(),
      invalidateUserTokens: jest.fn(),
    } as unknown as jest.Mocked<TokenManagerService>

    mockSessionService = {
      createSession: jest.fn(),
      findByRefreshToken: jest.fn(),
      rotateRefreshToken: jest.fn(),
      deleteByRefreshToken: jest.fn(),
      deleteAllByUserId: jest.fn(),
      getUserSessions: jest.fn(),
      deleteSession: jest.fn(),
      deleteOtherSessions: jest.fn(),
      cleanupExpired: jest.fn(),
    } as unknown as jest.Mocked<SessionService>

    mockEmailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
    }

    mockUserCacheService = {
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    }

    mockEnvService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          FRONTEND_URL: 'https://app.example.com',
          PASSWORD_RESET_EXPIRY_MINUTES: 15,
          EMAIL_VERIFICATION_EXPIRY_HOURS: 48,
          SUPPORT_EMAIL: 'support@example.com',
        }
        return values[key]
      }),
    }

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }

    const prisma = mockContextToPrisma(mockCtx)
    authService = new AuthService(
      prisma,
      mockTokenService,
      mockTokenManager,
      mockSessionService,
      mockEmailService as never,
      mockUserCacheService as never,
      mockEnvService as never,
      mockCache as never
    )

    jest.clearAllMocks()
  })

  describe('register', () => {
    const registerInput: RegisterInput = {
      email: 'newuser@example.com',
      password: 'Password123',
      name: 'New User',
    }

    const requestInfo = {
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
    }

    it('should register new user successfully', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed-password')
      mockCtx.prisma.user.create.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('access-token-123')
      mockSessionService.createSession.mockResolvedValue('refresh-token-456')

      const result = await authService.register(registerInput, requestInfo)

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerInput.email },
      })
      expect(argon2.hash).toHaveBeenCalledWith(registerInput.password)
      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: registerInput.email,
          passwordHash: 'hashed-password',
          name: registerInput.name,
          lastLoginAt: expect.any(Date),
        },
      })
      expect(result).toEqual({
        user: expect.objectContaining({ id: mockUser.id, email: mockUser.email }),
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      })
    })

    it('should register user without optional name', async () => {
      const inputWithoutName = { email: 'test@example.com', password: 'Password123' }

      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue({ ...mockUser, name: null })
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      const result = await authService.register(inputWithoutName, requestInfo)

      expect(result.user.name).toBeNull()
    })

    it('should throw ConflictException if user already exists', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      await expect(authService.register(registerInput, requestInfo)).rejects.toThrow(
        ConflictException
      )
      expect(argon2.hash).not.toHaveBeenCalled()
    })

    it('should set lastLoginAt during registration', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      const beforeRegister = new Date()
      await authService.register(registerInput, requestInfo)
      const afterRegister = new Date()

      const createCall = mockCtx.prisma.user.create.mock.calls[0]![0]!
      const lastLoginAt = createCall.data.lastLoginAt as Date

      expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeRegister.getTime())
      expect(lastLoginAt.getTime()).toBeLessThanOrEqual(afterRegister.getTime())
    })
  })

  describe('login', () => {
    const loginInput: LoginInput = {
      email: 'test@example.com',
      password: 'Password123',
    }

    const requestInfo = { userAgent: 'Mozilla/5.0', ipAddress: '192.168.1.1' }

    it('should login user successfully', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, lastLoginAt: new Date() })
      mockTokenService.generateAccessToken.mockReturnValue('access-token-123')
      mockSessionService.createSession.mockResolvedValue('refresh-token-456')

      const result = await authService.login(loginInput, requestInfo)

      expect(argon2.verify).toHaveBeenCalledWith(mockUser.passwordHash, loginInput.password)
      expect(result.accessToken).toBe('access-token-123')
      expect(result.refreshToken).toBe('refresh-token-456')
    })

    it('should throw UnauthorizedException if user not found', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        UnauthorizedException
      )
      expect(argon2.verify).not.toHaveBeenCalled()
    })

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(false)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        UnauthorizedException
      )
    })
  })

  describe('logout', () => {
    it('should logout user by invalidating refresh token', async () => {
      const refreshTokenHash = 'hashed-refresh-token'

      await authService.logout(refreshTokenHash)

      expect(mockSessionService.deleteByRefreshToken).toHaveBeenCalledWith(refreshTokenHash)
    })
  })

  describe('getUserById', () => {
    it('should return user by id', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await authService.getUserById('user-123')

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        emailVerified: mockUser.emailVerified,
        name: mockUser.name,
        avatarUrl: mockUser.avatarUrl,
        locale: mockUser.locale,
        timezone: mockUser.timezone,
        createdAt: mockUser.createdAt.toISOString(),
        lastLoginAt: mockUser.lastLoginAt!.toISOString(),
      })
    })

    it('should return null if user not found', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)

      expect(await authService.getUserById('non-existent-id')).toBeNull()
    })

    it('should not include passwordHash in response', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await authService.getUserById('user-123')

      expect(result).not.toHaveProperty('passwordHash')
    })
  })

  describe('forgotPassword', () => {
    it('should silently succeed for unknown email', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      mockCache.get.mockResolvedValue(null)

      await expect(authService.forgotPassword('unknown@example.com')).resolves.not.toThrow()

      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled()
    })

    it('should queue reset email for known user', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      mockCache.get.mockResolvedValue(null)
      mockTokenManager.generatePasswordResetToken.mockResolvedValue({
        token: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })

      await authService.forgotPassword(mockUser.email)

      expect(mockTokenManager.generatePasswordResetToken).toHaveBeenCalledWith(mockUser.id)
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.objectContaining({
          resetUrl: expect.stringContaining('reset-password?token='),
          expiresIn: '15 минут',
        })
      )
    })

    it('should throw if rate limit exceeded', async () => {
      mockCache.get.mockResolvedValue(3)

      await expect(authService.forgotPassword(mockUser.email)).rejects.toThrow(
        UnauthorizedException
      )
    })
  })

  describe('resetPassword', () => {
    it('should reset password and invalidate sessions', async () => {
      const tokenHash = 'a'.repeat(64)
      mockTokenManager.verifyPasswordResetToken.mockResolvedValue({
        userId: mockUser.id,
        tokenHash,
      })
      ;(argon2.hash as jest.Mock).mockResolvedValue('new-hashed-password')
      ;(mockCtx.prisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: typeof mockCtx.prisma) => Promise<unknown>) => fn(mockCtx.prisma)
      )
      mockCtx.prisma.passwordResetToken.update.mockResolvedValue({} as never)
      mockCtx.prisma.user.update.mockResolvedValue(mockUser)
      mockSessionService.deleteAllByUserId.mockResolvedValue(undefined)
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      await authService.resetPassword('a'.repeat(64), 'NewPassword123')

      expect(mockTokenManager.verifyPasswordResetToken).toHaveBeenCalled()
      expect(mockSessionService.deleteAllByUserId).toHaveBeenCalledWith(mockUser.id)
      expect(mockUserCacheService.invalidateUser).toHaveBeenCalledWith(mockUser.id)
      expect(mockEmailService.sendPasswordChangedEmail).toHaveBeenCalled()
    })
  })

  describe('verifyEmail', () => {
    it('should verify email and invalidate cache', async () => {
      const tokenHash = 'a'.repeat(64)
      mockTokenManager.verifyEmailVerificationToken.mockResolvedValue({
        userId: mockUser.id,
        tokenHash,
      })
      ;(mockCtx.prisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: typeof mockCtx.prisma) => Promise<unknown>) => fn(mockCtx.prisma)
      )
      mockCtx.prisma.emailVerificationToken.update.mockResolvedValue({} as never)
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, emailVerified: true })

      await authService.verifyEmail('a'.repeat(64))

      expect(mockTokenManager.verifyEmailVerificationToken).toHaveBeenCalled()
      expect(mockUserCacheService.invalidateUser).toHaveBeenCalledWith(mockUser.id)
    })
  })

  describe('resendVerificationEmail', () => {
    it('should silently succeed for already-verified user', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({ ...mockUser, emailVerified: true })
      mockCache.get.mockResolvedValue(null)

      await expect(authService.resendVerificationEmail(mockUser.email)).resolves.not.toThrow()

      expect(mockEmailService.sendEmailVerificationEmail).not.toHaveBeenCalled()
    })

    it('should queue verification email for unverified user', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      mockCache.get.mockResolvedValue(null)
      mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
        token: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })

      await authService.resendVerificationEmail(mockUser.email)

      expect(mockEmailService.sendEmailVerificationEmail).toHaveBeenCalledWith(
        mockUser.email,
        expect.objectContaining({
          verificationUrl: expect.stringContaining('verify-email?token='),
          expiresIn: '48 часов',
        })
      )
    })
  })
})
