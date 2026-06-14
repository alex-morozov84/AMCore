import { SystemRole, type User } from '@prisma/client'
import * as argon2 from 'argon2'
import type { PinoLogger } from 'nestjs-pino'

import type { LoginInput, RegisterInput } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import type { AuditLogService } from '../audit'

import { AuthService } from './auth.service'
import { EmailIdentityService } from './email-identity.service'
import { LoginRateLimiterService } from './login-rate-limiter.service'
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
    sendWelcomeEmail: jest.Mock
    sendPasswordResetEmail: jest.Mock
    sendPasswordChangedEmail: jest.Mock
    sendEmailVerificationEmail: jest.Mock
  }
  let mockUserCacheService: jest.Mocked<Pick<UserCacheService, 'invalidateUser'>>
  let mockEnvService: { get: jest.Mock }
  let mockCache: { get: jest.Mock; set: jest.Mock }
  let mockLoginRateLimiter: jest.Mocked<LoginRateLimiterService>
  let mockAuditLog: jest.Mocked<Pick<AuditLogService, 'record'>>
  let mockLogger: jest.Mocked<PinoLogger>

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailCanonical: 'test@example.com',
    emailVerified: false,
    passwordHash: 'hashed-password-123',
    name: 'Test User',
    avatarUrl: null,
    avatarGeneration: 0,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: new Date('2024-01-01'),
    systemRole: SystemRole.USER,
  }

  const mockCreateSessionResult = (refreshToken: string) => ({
    session: { id: 'session-123' },
    refreshToken,
  })

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
      generateEmailVerificationToken: jest.fn().mockResolvedValue({
        token: 'default-verify-token',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      }),
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
      touchLastAuth: jest.fn(),
      hasLiveSession: jest.fn(),
    } as unknown as jest.Mocked<SessionService>

    mockEmailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
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

    mockLoginRateLimiter = {
      check: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginRateLimiterService>
    mockAuditLog = { record: jest.fn().mockResolvedValue(undefined) }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    const prisma = mockContextToPrisma(mockCtx)
    authService = new AuthService(
      prisma,
      mockTokenService,
      mockTokenManager,
      mockSessionService,
      mockEmailService as never,
      mockUserCacheService as never,
      mockEnvService as never,
      new EmailIdentityService(),
      mockAuditLog as never,
      mockCache as never,
      mockLoginRateLimiter,
      mockLogger
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
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh-token-456') as never
      )

      const result = await authService.register(registerInput, requestInfo)

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: registerInput.email },
      })
      expect(argon2.hash).toHaveBeenCalledWith(registerInput.password)
      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: registerInput.email,
          emailCanonical: registerInput.email,
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
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh') as never
      )

      const result = await authService.register(inputWithoutName, requestInfo)

      expect(result.user.name).toBeNull()
    })

    it('should preserve display email and store canonical email', async () => {
      const mixedCaseInput = {
        email: 'User@Example.COM',
        password: 'Password123',
      }

      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue({ ...mockUser, email: mixedCaseInput.email })
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh') as never
      )

      await authService.register(mixedCaseInput, requestInfo)

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'user@example.com' },
      })
      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'User@Example.COM',
          emailCanonical: 'user@example.com',
        }),
      })
    })

    it('should throw AppException if user already exists', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      await expect(authService.register(registerInput, requestInfo)).rejects.toThrow(AppException)
      expect(argon2.hash).not.toHaveBeenCalled()
    })

    it('should set lastLoginAt during registration', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh') as never
      )

      const beforeRegister = new Date()
      await authService.register(registerInput, requestInfo)
      const afterRegister = new Date()

      const createCall = mockCtx.prisma.user.create.mock.calls[0]![0]!
      const lastLoginAt = createCall.data.lastLoginAt as Date

      expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeRegister.getTime())
      expect(lastLoginAt.getTime()).toBeLessThanOrEqual(afterRegister.getTime())
    })

    /**
     * Regression: register() must generate the verification token in-band so
     * the row is committed before HTTP 201 returns. Earlier code did
     * `void this.resendVerificationEmail(user.email).catch(...)` which is a
     * race: its first step invalidates existing tokens, so a subsequent
     * verify-email or resend-verification could be silently poisoned. The
     * race was env-dependent (macOS won it, WSL2 lost it). Lock the
     * behavior down.
     */
    describe('email verification token race fix', () => {
      const setupRegisterMocks = () => {
        mockCtx.prisma.user.findUnique.mockResolvedValue(null)
        ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
        mockCtx.prisma.user.create.mockResolvedValue(mockUser)
        mockTokenService.generateAccessToken.mockReturnValue('token')
        mockSessionService.createSession.mockResolvedValue(
          mockCreateSessionResult('refresh') as never
        )
      }

      it('generates verification token via tokenManager inside register()', async () => {
        setupRegisterMocks()
        mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
          token: 'verify-token-abc',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })

        await authService.register(registerInput, requestInfo)

        expect(mockTokenManager.generateEmailVerificationToken).toHaveBeenCalledTimes(1)
        expect(mockTokenManager.generateEmailVerificationToken).toHaveBeenCalledWith(mockUser.id)
      })

      it('does not call resendVerificationEmail from register()', async () => {
        setupRegisterMocks()
        mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
          token: 'verify-token-abc',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })
        const resendSpy = jest.spyOn(authService, 'resendVerificationEmail')

        await authService.register(registerInput, requestInfo)

        expect(resendSpy).not.toHaveBeenCalled()
      })

      it('passes the generated token in the email verification URL', async () => {
        setupRegisterMocks()
        mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
          token: 'verify-token-xyz',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })

        await authService.register(registerInput, requestInfo)

        // Email send is fire-and-forget; let the microtask queue drain.
        await new Promise((resolve) => setImmediate(resolve))

        expect(mockEmailService.sendEmailVerificationEmail).toHaveBeenCalledTimes(1)
        const [, payload] = mockEmailService.sendEmailVerificationEmail.mock.calls[0]!
        expect(payload.verificationUrl).toContain('token=verify-token-xyz')
      })

      it('awaits token generation before returning the auth response', async () => {
        setupRegisterMocks()
        let resolveToken!: (value: { token: string; expiresAt: Date }) => void
        const pending = new Promise<{ token: string; expiresAt: Date }>((resolve) => {
          resolveToken = resolve
        })
        mockTokenManager.generateEmailVerificationToken.mockReturnValue(pending)

        let resolved = false
        const registerPromise = authService.register(registerInput, requestInfo).then((res) => {
          resolved = true
          return res
        })

        // Let microtasks settle; register() must still be pending on the
        // unresolved token generation.
        await new Promise((resolve) => setImmediate(resolve))
        expect(resolved).toBe(false)

        resolveToken({
          token: 'late-token',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })
        await expect(registerPromise).resolves.toBeDefined()
        expect(resolved).toBe(true)
      })

      it('does not fail register() when the verification email send rejects', async () => {
        setupRegisterMocks()
        mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
          token: 'verify-token-abc',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })
        mockEmailService.sendEmailVerificationEmail.mockRejectedValue(new Error('SMTP unavailable'))

        await expect(authService.register(registerInput, requestInfo)).resolves.toMatchObject({
          accessToken: 'token',
          refreshToken: 'refresh',
        })

        // Let the catch handler run on the rejected fire-and-forget send.
        await new Promise((resolve) => setImmediate(resolve))
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Failed to send verification email'
        )
      })

      it('does not fail register() when the welcome email send rejects', async () => {
        setupRegisterMocks()
        mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
          token: 'verify-token-abc',
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        })
        mockEmailService.sendWelcomeEmail.mockRejectedValue(new Error('SMTP unavailable'))

        await expect(authService.register(registerInput, requestInfo)).resolves.toMatchObject({
          accessToken: 'token',
          refreshToken: 'refresh',
        })

        await new Promise((resolve) => setImmediate(resolve))
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Failed to send welcome email'
        )
      })
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
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh-token-456') as never
      )

      const result = await authService.login(loginInput, requestInfo)

      expect(argon2.verify).toHaveBeenCalledWith(mockUser.passwordHash, loginInput.password)
      expect(result.accessToken).toBe('access-token-123')
      expect(result.refreshToken).toBe('refresh-token-456')
    })

    it('should throw AppException if user not found', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(AppException)
      expect(argon2.verify).not.toHaveBeenCalled()
    })

    it('should throw AppException if password is invalid', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(false)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(AppException)
    })

    it('should consume rate limit on failed login', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(false)

      await authService.login(loginInput, requestInfo).catch(() => undefined)

      expect(mockLoginRateLimiter.consume).toHaveBeenCalledWith(
        loginInput.email,
        requestInfo.ipAddress
      )
    })

    it('should reset rate limit on successful login', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, lastLoginAt: new Date() })
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh') as never
      )

      await authService.login(loginInput, requestInfo)

      expect(mockLoginRateLimiter.reset).toHaveBeenCalledWith(
        loginInput.email,
        requestInfo.ipAddress
      )
    })

    it('should lookup and rate-limit login by canonical email', async () => {
      const mixedCaseLogin = { email: 'Test@Example.COM', password: 'Password123' }

      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, lastLoginAt: new Date() })
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue(
        mockCreateSessionResult('refresh') as never
      )

      await authService.login(mixedCaseLogin, requestInfo)

      expect(mockLoginRateLimiter.check).toHaveBeenCalledWith(
        'test@example.com',
        requestInfo.ipAddress
      )
      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'test@example.com' },
      })
    })

    it('should throw 429 when rate limit is exceeded', async () => {
      mockLoginRateLimiter.check.mockRejectedValue(
        new AppException('Too many failed login attempts', 429)
      )

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(AppException)
      expect(mockCtx.prisma.user.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('should logout user by invalidating refresh token', async () => {
      const refreshTokenHash = 'hashed-refresh-token'

      await authService.logout(refreshTokenHash)

      expect(mockSessionService.deleteByRefreshToken).toHaveBeenCalledWith(refreshTokenHash)
    })
  })

  describe('stepUp (OB-06b)', () => {
    const principal = {
      type: 'jwt' as const,
      sub: 'user-123',
      email: 'test@example.com',
      systemRole: SystemRole.USER,
      sid: 'session-123',
    }

    it('rejects a token without sid (STEP_UP_REQUIRED) without touching the session', async () => {
      await expect(
        authService.stepUp({ ...principal, sid: undefined }, 'pw', '1.2.3.4')
      ).rejects.toMatchObject({ errorCode: AuthErrorCode.STEP_UP_REQUIRED })
      expect(mockSessionService.hasLiveSession).not.toHaveBeenCalled()
      expect(mockCtx.prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('rejects a non-live session BEFORE any password work (no password oracle)', async () => {
      // Stolen-but-revoked/expired token: must fail closed before loading the
      // user, hitting the limiter, or verifying the password.
      mockSessionService.hasLiveSession.mockResolvedValue(false)

      await expect(authService.stepUp(principal, 'pw', '1.2.3.4')).rejects.toMatchObject({
        errorCode: AuthErrorCode.STEP_UP_REQUIRED,
      })
      expect(mockCtx.prisma.user.findUnique).not.toHaveBeenCalled()
      expect(mockLoginRateLimiter.check).not.toHaveBeenCalled()
      expect(argon2.verify).not.toHaveBeenCalled()
      expect(mockSessionService.touchLastAuth).not.toHaveBeenCalled()
    })

    it('rejects a password-less (OAuth-only) account with STEP_UP_METHOD_UNAVAILABLE', async () => {
      mockSessionService.hasLiveSession.mockResolvedValue(true)
      mockCtx.prisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: null })

      await expect(authService.stepUp(principal, 'pw', '1.2.3.4')).rejects.toMatchObject({
        errorCode: AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE,
      })
      expect(argon2.verify).not.toHaveBeenCalled()
      expect(mockSessionService.touchLastAuth).not.toHaveBeenCalled()
    })

    it('rejects a wrong password with INVALID_CREDENTIALS and consumes the limiter', async () => {
      mockSessionService.hasLiveSession.mockResolvedValue(true)
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(false)

      await expect(authService.stepUp(principal, 'wrong', '1.2.3.4')).rejects.toMatchObject({
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      })
      expect(mockLoginRateLimiter.check).toHaveBeenCalledWith(mockUser.emailCanonical, '1.2.3.4')
      expect(mockLoginRateLimiter.consume).toHaveBeenCalledWith(mockUser.emailCanonical, '1.2.3.4')
      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up_failed',
          actorId: mockUser.id,
        })
      )
      expect(mockSessionService.touchLastAuth).not.toHaveBeenCalled()
    })

    it('fails closed when the session is revoked between precheck and bump (count 0)', async () => {
      mockSessionService.hasLiveSession.mockResolvedValue(true)
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockSessionService.touchLastAuth.mockResolvedValue(0)

      await expect(authService.stepUp(principal, 'right', '1.2.3.4')).rejects.toMatchObject({
        errorCode: AuthErrorCode.STEP_UP_REQUIRED,
      })
    })

    it('succeeds: bumps only the current session, resets limiter, returns a fresh sid token', async () => {
      mockSessionService.hasLiveSession.mockResolvedValue(true)
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockSessionService.touchLastAuth.mockResolvedValue(1)
      mockTokenService.generateAccessToken.mockReturnValue('fresh-access-token')

      const result = await authService.stepUp(principal, 'right', '1.2.3.4')

      expect(result).toEqual({ accessToken: 'fresh-access-token' })
      expect(mockSessionService.touchLastAuth).toHaveBeenCalledWith('session-123', 'user-123')
      expect(mockLoginRateLimiter.reset).toHaveBeenCalledWith(mockUser.emailCanonical, '1.2.3.4')
      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith({
        sub: 'user-123',
        email: mockUser.email,
        systemRole: mockUser.systemRole,
        sid: 'session-123',
      })
      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.step_up_succeeded',
          actorId: mockUser.id,
        })
      )
      // No new session, no rotation.
      expect(mockSessionService.createSession).not.toHaveBeenCalled()
      expect(mockSessionService.rotateRefreshToken).not.toHaveBeenCalled()
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
        phone: mockUser.phone,
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

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'unknown@example.com' },
      })
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

    it('should lookup password reset by canonical email but send to display email', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue({ ...mockUser, email: 'Test@Example.COM' })
      mockCache.get.mockResolvedValue(null)
      mockTokenManager.generatePasswordResetToken.mockResolvedValue({
        token: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })

      await authService.forgotPassword(' test@example.com ')

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: 'test@example.com' },
      })
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'Test@Example.COM',
        expect.objectContaining({ name: 'Test User' })
      )
    })

    it('should throw if rate limit exceeded', async () => {
      mockCache.get.mockResolvedValue(3)

      await expect(authService.forgotPassword(mockUser.email)).rejects.toThrow(AppException)
    })

    it('does not throw when the direct send fails (no enumeration oracle — EQS-02)', async () => {
      // sendNow throws on provider failure; for a KNOWN email that must not
      // become a 500 while unknown emails return 200.
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      mockCache.get.mockResolvedValue(null)
      mockTokenManager.generatePasswordResetToken.mockResolvedValue({
        token: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })
      mockEmailService.sendPasswordResetEmail.mockRejectedValue(new Error('provider down'))

      await expect(authService.forgotPassword(mockUser.email)).resolves.not.toThrow()
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

    it('still resolves when the password-changed email enqueue fails (EQS-06)', async () => {
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
      // Simulate a Redis/BullMQ outage on the queued PASSWORD_CHANGED send.
      mockEmailService.sendPasswordChangedEmail.mockRejectedValue(new Error('Redis down'))

      // Best-effort fire-and-forget: the reset must NOT reject.
      await expect(
        authService.resetPassword('a'.repeat(64), 'NewPassword123')
      ).resolves.toBeUndefined()

      // Password change + session invalidation still happened.
      expect(mockCtx.prisma.user.update).toHaveBeenCalled()
      expect(mockSessionService.deleteAllByUserId).toHaveBeenCalledWith(mockUser.id)

      // The swallowed failure is logged at warn (flush the microtask queue first).
      await Promise.resolve()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.stringContaining('Failed to send password changed email')
      )
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

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailCanonical: mockUser.emailCanonical },
      })
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

    it('does not throw when the direct send fails (no enumeration oracle — EQS-02)', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      mockCache.get.mockResolvedValue(null)
      mockTokenManager.generateEmailVerificationToken.mockResolvedValue({
        token: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })
      mockEmailService.sendEmailVerificationEmail.mockRejectedValue(new Error('provider down'))

      await expect(authService.resendVerificationEmail(mockUser.email)).resolves.not.toThrow()
    })
  })
})
