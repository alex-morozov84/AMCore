import type { ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { SystemRole as PrismaSystemRole, type User } from '@prisma/client'
import type { Request, Response } from 'express'

import {
  AuthErrorCode,
  type RequestPrincipal,
  type SessionsListResponse,
  SystemRole,
  type UserResponse,
} from '@amcore/shared'

import { AppException, ConflictException, UnauthorizedException } from '../../common/exceptions'

// Mock email module to prevent TSX/ESM import issues
jest.mock('../../infrastructure/email', () => ({
  EmailService: jest.fn(),
}))

import { EnvService } from '../../env/env.service'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AvatarService } from './avatar.service'
import type {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto'
import { JwtAuthGuard, RefreshTokenGuard } from './guards'
import { SessionService } from './session.service'
import { TokenService } from './token.service'

describe('AuthController', () => {
  let controller: AuthController
  let authService: jest.Mocked<AuthService>
  let avatarService: jest.Mocked<AvatarService>
  let sessionService: jest.Mocked<SessionService>
  let tokenService: jest.Mocked<TokenService>
  let envService: jest.Mocked<EnvService>

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailCanonical: 'test@example.com',
    emailVerified: true,
    passwordHash: 'hashed-password',
    name: 'Test User',
    avatarUrl: null,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    lastLoginAt: new Date('2025-01-27'),
    systemRole: PrismaSystemRole.USER,
  }

  const mockPrincipal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-123',
    systemRole: SystemRole.User,
  }

  const mockUserResponse: UserResponse = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: true,
    name: 'Test User',
    avatarUrl: null,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: '2025-01-01T00:00:00.000Z',
    lastLoginAt: '2025-01-27T00:00:00.000Z',
  }

  const mockAccessToken = 'mock-access-token'
  const mockRefreshToken = 'mock-refresh-token'

  const mockRequest = {
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
    cookies: {},
  } as unknown as Request

  const mockResponse = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            logout: jest.fn(),
            getUserById: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            verifyEmail: jest.fn(),
            resendVerificationEmail: jest.fn(),
          },
        },
        {
          provide: SessionService,
          useValue: {
            rotateRefreshToken: jest.fn(),
            getUserSessions: jest.fn(),
            deleteSession: jest.fn(),
            deleteOtherSessions: jest.fn(),
          },
        },
        {
          provide: AvatarService,
          useValue: {
            setAvatar: jest.fn(),
            removeAvatar: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            generateAccessToken: jest.fn(),
            hashRefreshToken: jest.fn(),
          },
        },
        {
          provide: EnvService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'NODE_ENV') return 'test'
              return undefined
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest()
          request.user = mockUser
          return true
        },
      })
      .overrideGuard(RefreshTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest()
          request.user = {
            user: mockUser,
            refreshTokenHash: 'hashed-refresh-token',
          }
          return true
        },
      })
      .compile()

    controller = module.get<AuthController>(AuthController)
    authService = module.get(AuthService)
    avatarService = module.get(AvatarService)
    sessionService = module.get(SessionService)
    tokenService = module.get(TokenService)
    envService = module.get(EnvService)

    // Reset mocks
    jest.clearAllMocks()
  })

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'newuser@example.com',
      password: 'StrongP@ss123',
    }

    it('should register user and set refresh token cookie', async () => {
      authService.register.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      })

      const result = await controller.register(registerDto, mockRequest, mockResponse)

      expect(authService.register).toHaveBeenCalledWith(registerDto, {
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      })
      expect(mockResponse.cookie).toHaveBeenCalledWith('refresh_token', mockRefreshToken, {
        httpOnly: true,
        secure: false, // test env
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      expect(result).toEqual({
        user: mockUserResponse,
        accessToken: mockAccessToken,
      })
    })

    it('should use secure cookies in production', async () => {
      envService.get.mockReturnValue('production')

      authService.register.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      })

      await controller.register(registerDto, mockRequest, mockResponse)

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockRefreshToken,
        expect.objectContaining({ secure: true })
      )
    })

    it('should throw ConflictException if user exists', async () => {
      authService.register.mockRejectedValue(new ConflictException('Пользователь уже существует'))

      await expect(controller.register(registerDto, mockRequest, mockResponse)).rejects.toThrow(
        ConflictException
      )
    })

    it('should extract user agent and IP from request', async () => {
      const customRequest = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        ip: '192.168.1.1',
        cookies: {},
      } as unknown as Request

      authService.register.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      })

      await controller.register(registerDto, customRequest, mockResponse)

      expect(authService.register).toHaveBeenCalledWith(registerDto, {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })
    })
  })

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'Password123',
    }

    it('should login user and set refresh token cookie', async () => {
      authService.login.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      })

      const result = await controller.login(loginDto, mockRequest, mockResponse)

      expect(authService.login).toHaveBeenCalledWith(loginDto, {
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      })
      expect(mockResponse.cookie).toHaveBeenCalledWith('refresh_token', mockRefreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      expect(result).toEqual({
        user: mockUserResponse,
        accessToken: mockAccessToken,
      })
    })

    it('should throw UnauthorizedException for invalid credentials', async () => {
      authService.login.mockRejectedValue(new UnauthorizedException('Invalid email or password'))

      await expect(controller.login(loginDto, mockRequest, mockResponse)).rejects.toThrow(
        UnauthorizedException
      )
    })
  })

  describe('logout', () => {
    it('should logout user and clear refresh token cookie', async () => {
      const requestWithCookie = {
        ...mockRequest,
        cookies: { refresh_token: mockRefreshToken },
      } as unknown as Request

      tokenService.hashRefreshToken.mockReturnValue('hashed-token')
      authService.logout.mockResolvedValue()

      await controller.logout(requestWithCookie, mockResponse)

      expect(tokenService.hashRefreshToken).toHaveBeenCalledWith(mockRefreshToken)
      expect(authService.logout).toHaveBeenCalledWith('hashed-token')
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' })
    })

    it('should clear cookie even if no refresh token provided', async () => {
      authService.logout.mockResolvedValue()

      await controller.logout(mockRequest, mockResponse)

      expect(tokenService.hashRefreshToken).not.toHaveBeenCalled()
      expect(authService.logout).not.toHaveBeenCalled()
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' })
    })

    it('should handle logout errors gracefully', async () => {
      const requestWithCookie = {
        ...mockRequest,
        cookies: { refresh_token: mockRefreshToken },
      } as unknown as Request

      tokenService.hashRefreshToken.mockReturnValue('hashed-token')
      authService.logout.mockRejectedValue(new Error('Session not found'))

      await expect(controller.logout(requestWithCookie, mockResponse)).rejects.toThrow(
        'Session not found'
      )
      expect(mockResponse.clearCookie).not.toHaveBeenCalled()
    })
  })

  describe('refresh', () => {
    const requestWithUser = {
      ...mockRequest,
      user: {
        user: mockUser,
        refreshTokenHash: 'old-hashed-token',
      },
    } as Request & { user: { user: User; refreshTokenHash: string } }

    it('should rotate refresh token and return new access token', async () => {
      const newRefreshToken = 'new-refresh-token'
      const newAccessToken = 'new-access-token'

      sessionService.rotateRefreshToken.mockResolvedValue({
        refreshToken: newRefreshToken,
        sessionId: 'session-123',
      })
      tokenService.generateAccessToken.mockReturnValue(newAccessToken)

      const result = await controller.refresh(requestWithUser, mockResponse)

      expect(sessionService.rotateRefreshToken).toHaveBeenCalledWith('old-hashed-token', {
        userId: mockUser.id,
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      })
      expect(tokenService.generateAccessToken).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        systemRole: mockUser.systemRole,
        sid: 'session-123',
      })
      expect(mockResponse.cookie).toHaveBeenCalledWith('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      expect(result).toEqual({ accessToken: newAccessToken })
    })

    it('should throw error if refresh token rotation fails', async () => {
      sessionService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token')
      )

      await expect(controller.refresh(requestWithUser, mockResponse)).rejects.toThrow(
        UnauthorizedException
      )
      expect(mockResponse.cookie).not.toHaveBeenCalled()
    })
  })

  describe('me', () => {
    it('should return current user profile', async () => {
      authService.getUserById.mockResolvedValue(mockUserResponse)

      const result = await controller.me(mockPrincipal)

      expect(authService.getUserById).toHaveBeenCalledWith(mockPrincipal.sub)
      expect(result).toEqual({ user: mockUserResponse })
    })

    it('should return null if user not found', async () => {
      authService.getUserById.mockResolvedValue(null)

      const result = await controller.me(mockPrincipal)

      expect(result).toEqual({ user: null })
    })
  })

  describe('avatar', () => {
    const avatarFile = {
      buffer: Buffer.from('avatar-bytes'),
      mimetype: 'image/png',
    }

    it('uploads current user avatar', async () => {
      avatarService.setAvatar.mockResolvedValue('https://cdn.example.test/avatars/user-123')

      const result = await controller.uploadAvatar(mockUser.id, avatarFile)

      expect(avatarService.setAvatar).toHaveBeenCalledWith(mockUser.id, avatarFile)
      expect(result).toEqual({ avatarUrl: 'https://cdn.example.test/avatars/user-123' })
    })

    it('deletes current user avatar', async () => {
      avatarService.removeAvatar.mockResolvedValue()

      await controller.deleteAvatar(mockUser.id)

      expect(avatarService.removeAvatar).toHaveBeenCalledWith(mockUser.id)
    })
  })

  describe('sessions', () => {
    const mockEnvelope: SessionsListResponse = {
      data: [
        {
          id: 'session-1',
          userAgent: 'test-agent',
          ipAddress: '127.0.0.1',
          createdAt: '2025-01-27T10:00:00.000Z',
          current: true,
        },
        {
          id: 'session-2',
          userAgent: 'mobile-agent',
          ipAddress: '192.168.1.1',
          createdAt: '2025-01-26T10:00:00.000Z',
          current: false,
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    }
    const defaultPagination = { page: 1, limit: 20 }

    it('returns paginated envelope with current marked (OB-05)', async () => {
      const requestWithCookie = {
        ...mockRequest,
        cookies: { refresh_token: mockRefreshToken },
      } as unknown as Request

      tokenService.hashRefreshToken.mockReturnValue('current-hashed-token')
      sessionService.getUserSessions.mockResolvedValue(mockEnvelope)

      const result = await controller.sessions(mockUser.id, requestWithCookie, defaultPagination)

      expect(tokenService.hashRefreshToken).toHaveBeenCalledWith(mockRefreshToken)
      expect(sessionService.getUserSessions).toHaveBeenCalledWith(
        mockUser.id,
        'current-hashed-token',
        1,
        20
      )
      expect(result).toEqual(mockEnvelope)
    })

    it('forwards undefined currentHash when no cookie', async () => {
      sessionService.getUserSessions.mockResolvedValue(mockEnvelope)

      const result = await controller.sessions(mockUser.id, mockRequest, defaultPagination)

      expect(tokenService.hashRefreshToken).not.toHaveBeenCalled()
      expect(sessionService.getUserSessions).toHaveBeenCalledWith(mockUser.id, undefined, 1, 20)
      expect(result).toEqual(mockEnvelope)
    })
  })

  describe('revokeSession', () => {
    it('should revoke specific session', async () => {
      const sessionId = 'session-123'
      sessionService.deleteSession.mockResolvedValue()

      await controller.revokeSession(mockUser.id, sessionId)

      expect(sessionService.deleteSession).toHaveBeenCalledWith(sessionId, mockUser.id)
    })

    it('should throw error if session not found', async () => {
      const sessionId = 'nonexistent'
      sessionService.deleteSession.mockRejectedValue(new Error('Session not found'))

      await expect(controller.revokeSession(mockUser.id, sessionId)).rejects.toThrow(
        'Session not found'
      )
    })
  })

  describe('revokeOtherSessions', () => {
    it('should revoke all sessions except current', async () => {
      const requestWithCookie = {
        ...mockRequest,
        cookies: { refresh_token: mockRefreshToken },
      } as unknown as Request

      tokenService.hashRefreshToken.mockReturnValue('current-hashed-token')
      sessionService.deleteOtherSessions.mockResolvedValue()

      await controller.revokeOtherSessions(mockUser.id, requestWithCookie)

      expect(tokenService.hashRefreshToken).toHaveBeenCalledWith(mockRefreshToken)
      expect(sessionService.deleteOtherSessions).toHaveBeenCalledWith(
        mockUser.id,
        'current-hashed-token'
      )
    })

    it('should return early if no active session cookie', async () => {
      await controller.revokeOtherSessions(mockUser.id, mockRequest)

      expect(tokenService.hashRefreshToken).not.toHaveBeenCalled()
      expect(sessionService.deleteOtherSessions).not.toHaveBeenCalled()
    })
  })

  describe('forgotPassword', () => {
    it('should call service and return accepted message', async () => {
      authService.forgotPassword.mockResolvedValue(undefined)
      const dto: ForgotPasswordDto = { email: 'test@example.com' }

      const result = await controller.forgotPassword(dto)

      expect(authService.forgotPassword).toHaveBeenCalledWith('test@example.com')
      expect(result.message).toContain('If an account')
    })

    it('should return same response regardless of email existence (no enumeration)', async () => {
      authService.forgotPassword.mockResolvedValue(undefined)

      const result1 = await controller.forgotPassword({ email: 'exists@example.com' })
      const result2 = await controller.forgotPassword({ email: 'unknown@example.com' })

      expect(result1.message).toBe(result2.message)
    })

    it('should propagate rate limit error from service', async () => {
      authService.forgotPassword.mockRejectedValue(
        new AppException('Rate limit exceeded', 429, AuthErrorCode.RATE_LIMIT_EXCEEDED)
      )

      await expect(controller.forgotPassword({ email: 'test@example.com' })).rejects.toThrow(
        AppException
      )
    })
  })

  describe('resetPassword', () => {
    it('should call service with token and new password', async () => {
      authService.resetPassword.mockResolvedValue(undefined)
      const dto: ResetPasswordDto = { token: 'a'.repeat(64), password: 'NewPass123' }

      await controller.resetPassword(dto)

      expect(authService.resetPassword).toHaveBeenCalledWith('a'.repeat(64), 'NewPass123')
    })

    it('should propagate error for invalid token', async () => {
      authService.resetPassword.mockRejectedValue(
        new AppException('Invalid or expired token', 401, AuthErrorCode.TOKEN_INVALID)
      )

      await expect(
        controller.resetPassword({ token: 'invalid', password: 'NewPass123' })
      ).rejects.toThrow(AppException)
    })
  })

  describe('verifyEmail', () => {
    it('should call service with token', async () => {
      authService.verifyEmail.mockResolvedValue(undefined)
      const dto: VerifyEmailDto = { token: 'a'.repeat(64) }

      await controller.verifyEmail(dto)

      expect(authService.verifyEmail).toHaveBeenCalledWith('a'.repeat(64))
    })

    it('should propagate error for invalid token', async () => {
      authService.verifyEmail.mockRejectedValue(
        new AppException('Invalid or expired token', 401, AuthErrorCode.TOKEN_INVALID)
      )

      await expect(controller.verifyEmail({ token: 'invalid' })).rejects.toThrow(AppException)
    })
  })

  describe('resendVerification', () => {
    it('should call service and return accepted message', async () => {
      authService.resendVerificationEmail.mockResolvedValue(undefined)
      const dto: ResendVerificationDto = { email: 'test@example.com' }

      const result = await controller.resendVerification(dto)

      expect(authService.resendVerificationEmail).toHaveBeenCalledWith('test@example.com')
      expect(result.message).toContain('If the account')
    })

    it('should return same response regardless of email or verification status', async () => {
      authService.resendVerificationEmail.mockResolvedValue(undefined)

      const result1 = await controller.resendVerification({ email: 'verified@example.com' })
      const result2 = await controller.resendVerification({ email: 'unverified@example.com' })

      expect(result1.message).toBe(result2.message)
    })

    it('should propagate rate limit error from service', async () => {
      authService.resendVerificationEmail.mockRejectedValue(
        new AppException('Rate limit exceeded', 429, AuthErrorCode.RATE_LIMIT_EXCEEDED)
      )

      await expect(controller.resendVerification({ email: 'test@example.com' })).rejects.toThrow(
        AppException
      )
    })
  })

  describe('integration', () => {
    it('should complete full auth flow: register → login → refresh → logout', async () => {
      // Register
      const registerDto: RegisterDto = {
        email: 'flow@example.com',
        password: 'FlowP@ss123',
      }
      authService.register.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      })

      const registerResult = await controller.register(registerDto, mockRequest, mockResponse)
      expect(registerResult.accessToken).toBeDefined()

      // Login
      const loginDto: LoginDto = {
        email: 'flow@example.com',
        password: 'FlowP@ss123',
      }
      authService.login.mockResolvedValue({
        user: mockUserResponse,
        accessToken: mockAccessToken,
        refreshToken: 'new-refresh-token',
      })

      const loginResult = await controller.login(loginDto, mockRequest, mockResponse)
      expect(loginResult.accessToken).toBeDefined()

      // Refresh
      const refreshRequest = {
        ...mockRequest,
        user: {
          user: mockUser,
          refreshTokenHash: 'hashed-token',
        },
      } as Request & { user: { user: User; refreshTokenHash: string } }

      sessionService.rotateRefreshToken.mockResolvedValue({
        refreshToken: 'rotated-refresh-token',
        sessionId: 'session-123',
      })
      tokenService.generateAccessToken.mockReturnValue('new-access-token')

      const refreshResult = await controller.refresh(refreshRequest, mockResponse)
      expect(refreshResult.accessToken).toBe('new-access-token')

      // Logout
      const logoutRequest = {
        ...mockRequest,
        cookies: { refresh_token: 'rotated-refresh-token' },
      } as unknown as Request

      tokenService.hashRefreshToken.mockReturnValue('hashed-rotated-token')
      authService.logout.mockResolvedValue()

      await controller.logout(logoutRequest, mockResponse)
      expect(authService.logout).toHaveBeenCalled()
    })
  })
})
