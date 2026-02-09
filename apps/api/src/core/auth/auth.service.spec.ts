import { ConflictException, UnauthorizedException } from '@nestjs/common'
import type { User } from '@prisma/client'
import * as argon2 from 'argon2'

import type { LoginInput, RegisterInput } from '@amcore/shared'

import { AuthService } from './auth.service'
import { SessionService } from './session.service'
import { createMockContext, type MockContext, mockContextToPrisma } from './test-context'
import { TokenService } from './token.service'

// Mock argon2
jest.mock('argon2')

describe('AuthService', () => {
  let authService: AuthService
  let mockCtx: MockContext
  let mockTokenService: jest.Mocked<TokenService>
  let mockSessionService: jest.Mocked<SessionService>

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

    mockSessionService = {
      createSession: jest.fn(),
      findByRefreshToken: jest.fn(),
      rotateRefreshToken: jest.fn(),
      deleteByRefreshToken: jest.fn(),
      getUserSessions: jest.fn(),
      deleteSession: jest.fn(),
      deleteOtherSessions: jest.fn(),
      cleanupExpired: jest.fn(),
    } as unknown as jest.Mocked<SessionService>

    const prisma = mockContextToPrisma(mockCtx)
    authService = new AuthService(prisma, mockTokenService, mockSessionService)

    // Clear mock calls
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
      // Arrange
      mockCtx.prisma.user.findUnique.mockResolvedValue(null) // No existing user
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed-password')
      mockCtx.prisma.user.create.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('access-token-123')
      mockSessionService.createSession.mockResolvedValue('refresh-token-456')

      // Act
      const result = await authService.register(registerInput, requestInfo)

      // Assert
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
      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      })
      expect(mockSessionService.createSession).toHaveBeenCalledWith({
        userId: mockUser.id,
        userAgent: requestInfo.userAgent,
        ipAddress: requestInfo.ipAddress,
      })
      expect(result).toEqual({
        user: expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
        }),
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      })
    })

    it('should register user without optional name', async () => {
      const inputWithoutName = {
        email: 'test@example.com',
        password: 'Password123',
      }

      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue({ ...mockUser, name: null })
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      const result = await authService.register(inputWithoutName, requestInfo)

      expect(mockCtx.prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: undefined,
        }),
      })
      expect(result.user.name).toBeNull()
    })

    it('should throw ConflictException if user already exists', async () => {
      // Arrange
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      // Act & Assert
      await expect(authService.register(registerInput, requestInfo)).rejects.toThrow(
        ConflictException
      )
      await expect(authService.register(registerInput, requestInfo)).rejects.toThrow(
        'Пользователь с таким email уже существует'
      )

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerInput.email },
      })
      expect(argon2.hash).not.toHaveBeenCalled()
      expect(mockCtx.prisma.user.create).not.toHaveBeenCalled()
    })

    it('should handle database errors during user creation', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockRejectedValue(new Error('Database connection failed'))

      await expect(authService.register(registerInput, requestInfo)).rejects.toThrow(
        'Database connection failed'
      )
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

    it('should create session with request info', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed')
      mockCtx.prisma.user.create.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      await authService.register(registerInput, requestInfo)

      expect(mockSessionService.createSession).toHaveBeenCalledWith({
        userId: mockUser.id,
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })
    })
  })

  describe('login', () => {
    const loginInput: LoginInput = {
      email: 'test@example.com',
      password: 'Password123',
    }

    const requestInfo = {
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.168.1.1',
    }

    it('should login user successfully', async () => {
      // Arrange
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue({ ...mockUser, lastLoginAt: new Date() })
      mockTokenService.generateAccessToken.mockReturnValue('access-token-123')
      mockSessionService.createSession.mockResolvedValue('refresh-token-456')

      // Act
      const result = await authService.login(loginInput, requestInfo)

      // Assert
      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: loginInput.email },
      })
      expect(argon2.verify).toHaveBeenCalledWith(mockUser.passwordHash, loginInput.password)
      expect(mockCtx.prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { lastLoginAt: expect.any(Date) },
      })
      expect(mockTokenService.generateAccessToken).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      })
      expect(mockSessionService.createSession).toHaveBeenCalledWith({
        userId: mockUser.id,
        userAgent: requestInfo.userAgent,
        ipAddress: requestInfo.ipAddress,
      })
      expect(result).toEqual({
        user: expect.objectContaining({
          id: mockUser.id,
          email: mockUser.email,
        }),
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      })
    })

    it('should throw UnauthorizedException if user not found', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(null)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        UnauthorizedException
      )
      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        'Неверный email или пароль'
      )

      expect(argon2.verify).not.toHaveBeenCalled()
    })

    it('should throw UnauthorizedException if user has no password hash', async () => {
      const userWithoutPassword = { ...mockUser, passwordHash: null }
      mockCtx.prisma.user.findUnique.mockResolvedValue(userWithoutPassword)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        UnauthorizedException
      )
      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        'Неверный email или пароль'
      )

      expect(argon2.verify).not.toHaveBeenCalled()
    })

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(false)

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        UnauthorizedException
      )
      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow(
        'Неверный email или пароль'
      )

      expect(mockCtx.prisma.user.update).not.toHaveBeenCalled()
    })

    it('should update lastLoginAt timestamp', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      const beforeLogin = new Date()
      await authService.login(loginInput, requestInfo)
      const afterLogin = new Date()

      const updateCall = mockCtx.prisma.user.update.mock.calls[0]![0]!
      const lastLoginAt = updateCall.data.lastLoginAt as Date

      expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime())
      expect(lastLoginAt.getTime()).toBeLessThanOrEqual(afterLogin.getTime())
    })

    it('should create session with request info', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue(mockUser)
      mockTokenService.generateAccessToken.mockReturnValue('token')
      mockSessionService.createSession.mockResolvedValue('refresh')

      await authService.login(loginInput, requestInfo)

      expect(mockSessionService.createSession).toHaveBeenCalledWith({
        userId: mockUser.id,
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })
    })

    it('should handle argon2 verification errors', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)
      ;(argon2.verify as jest.Mock).mockRejectedValue(new Error('Argon2 error'))

      await expect(authService.login(loginInput, requestInfo)).rejects.toThrow('Argon2 error')
    })
  })

  describe('logout', () => {
    it('should logout user by invalidating refresh token', async () => {
      const refreshTokenHash = 'hashed-refresh-token'

      await authService.logout(refreshTokenHash)

      expect(mockSessionService.deleteByRefreshToken).toHaveBeenCalledWith(refreshTokenHash)
    })

    it('should handle logout errors gracefully', async () => {
      const refreshTokenHash = 'invalid-hash'
      mockSessionService.deleteByRefreshToken.mockRejectedValue(new Error('Session not found'))

      await expect(authService.logout(refreshTokenHash)).rejects.toThrow('Session not found')
    })

    it('should not throw if session already deleted', async () => {
      const refreshTokenHash = 'non-existent-hash'
      mockSessionService.deleteByRefreshToken.mockResolvedValue(undefined)

      await expect(authService.logout(refreshTokenHash)).resolves.not.toThrow()
    })
  })

  describe('getUserById', () => {
    it('should return user by id', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await authService.getUserById('user-123')

      expect(mockCtx.prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      })
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

      const result = await authService.getUserById('non-existent-id')

      expect(result).toBeNull()
    })

    it('should not include passwordHash in response', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await authService.getUserById('user-123')

      expect(result).not.toHaveProperty('passwordHash')
    })

    it('should convert dates to ISO strings', async () => {
      mockCtx.prisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await authService.getUserById('user-123')

      expect(typeof result!.createdAt).toBe('string')
      expect(result!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('should handle null lastLoginAt', async () => {
      const userWithoutLastLogin = { ...mockUser, lastLoginAt: null }
      mockCtx.prisma.user.findUnique.mockResolvedValue(userWithoutLastLogin)

      const result = await authService.getUserById('user-123')

      expect(result!.lastLoginAt).toBeNull()
    })

    it('should handle database errors', async () => {
      mockCtx.prisma.user.findUnique.mockRejectedValue(new Error('Database error'))

      await expect(authService.getUserById('user-123')).rejects.toThrow('Database error')
    })
  })

  describe('integration - complete auth flow', () => {
    it('should support register → login → logout flow', async () => {
      // Register
      const registerInput: RegisterInput = {
        email: 'flow@example.com',
        password: 'Password123',
        name: 'Flow User',
      }

      mockCtx.prisma.user.findUnique.mockResolvedValue(null)
      ;(argon2.hash as jest.Mock).mockResolvedValue('hashed-pass')
      mockCtx.prisma.user.create.mockResolvedValue({ ...mockUser, email: 'flow@example.com' })
      mockTokenService.generateAccessToken.mockReturnValue('access-1')
      mockSessionService.createSession.mockResolvedValue('refresh-1')

      const registerResult = await authService.register(registerInput, {})

      expect(registerResult.user.email).toBe('flow@example.com')
      expect(registerResult.accessToken).toBe('access-1')
      expect(registerResult.refreshToken).toBe('refresh-1')

      // Login
      const loginInput: LoginInput = {
        email: 'flow@example.com',
        password: 'Password123',
      }

      mockCtx.prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        email: 'flow@example.com',
      })
      ;(argon2.verify as jest.Mock).mockResolvedValue(true)
      mockCtx.prisma.user.update.mockResolvedValue({
        ...mockUser,
        email: 'flow@example.com',
      })
      mockTokenService.generateAccessToken.mockReturnValue('access-2')
      mockSessionService.createSession.mockResolvedValue('refresh-2')

      const loginResult = await authService.login(loginInput, {})

      expect(loginResult.user.email).toBe('flow@example.com')
      expect(loginResult.accessToken).toBe('access-2')
      expect(loginResult.refreshToken).toBe('refresh-2')

      // Logout
      mockSessionService.deleteByRefreshToken.mockResolvedValue(undefined)

      await authService.logout('hashed-refresh-2')

      expect(mockSessionService.deleteByRefreshToken).toHaveBeenCalledWith('hashed-refresh-2')
    })
  })
})
