import { SystemRole, type Session, type User } from '@prisma/client'

import { NotFoundException } from '../../common/exceptions'

import { SessionService } from './session.service'
import { createMockContext, type MockContext, mockContextToPrisma } from './test-context'
import { TokenService } from './token.service'

describe('SessionService', () => {
  let sessionService: SessionService
  let mockCtx: MockContext
  let tokenService: jest.Mocked<TokenService>

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: false,
    passwordHash: 'hashed-password',
    name: 'Test User',
    avatarUrl: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: new Date('2024-01-01'),
    systemRole: SystemRole.USER,
  }

  const mockSession: Session = {
    id: 'session-123',
    userId: 'user-123',
    refreshToken: 'hashed-token',
    userAgent: 'Mozilla/5.0',
    ipAddress: '192.168.1.1',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  }

  beforeEach(() => {
    mockCtx = createMockContext()

    tokenService = {
      generateRefreshToken: jest.fn(),
      hashRefreshToken: jest.fn(),
      getRefreshTokenExpiration: jest.fn(),
      generateAccessToken: jest.fn(),
      verifyAccessToken: jest.fn(),
    } as unknown as jest.Mocked<TokenService>

    const prisma = mockContextToPrisma(mockCtx)
    sessionService = new SessionService(prisma, tokenService)
  })

  describe('createSession', () => {
    it('should create session and return raw refresh token', async () => {
      const rawToken = 'raw-refresh-token-abc123'
      const hashedToken = 'hashed-abc123'
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      tokenService.generateRefreshToken.mockReturnValue(rawToken)
      tokenService.hashRefreshToken.mockReturnValue(hashedToken)
      tokenService.getRefreshTokenExpiration.mockReturnValue(expiresAt)

      mockCtx.prisma.session.create.mockResolvedValue({
        ...mockSession,
        refreshToken: hashedToken,
        expiresAt,
      })

      const result = await sessionService.createSession({
        userId: 'user-123',
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      })

      expect(tokenService.generateRefreshToken).toHaveBeenCalled()
      expect(tokenService.hashRefreshToken).toHaveBeenCalledWith(rawToken)
      expect(tokenService.getRefreshTokenExpiration).toHaveBeenCalled()

      expect(mockCtx.prisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          refreshToken: hashedToken,
          userAgent: 'Mozilla/5.0',
          ipAddress: '192.168.1.1',
          expiresAt,
        },
      })

      expect(result).toBe(rawToken) // Returns RAW token, not hashed
    })

    it('should create session without userAgent and ipAddress', async () => {
      const rawToken = 'raw-token'
      const hashedToken = 'hashed-token'

      tokenService.generateRefreshToken.mockReturnValue(rawToken)
      tokenService.hashRefreshToken.mockReturnValue(hashedToken)
      tokenService.getRefreshTokenExpiration.mockReturnValue(new Date())

      mockCtx.prisma.session.create.mockResolvedValue(mockSession)

      const result = await sessionService.createSession({
        userId: 'user-456',
      })

      expect(mockCtx.prisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-456',
          refreshToken: hashedToken,
          userAgent: undefined,
          ipAddress: undefined,
          expiresAt: expect.any(Date),
        },
      })

      expect(result).toBe(rawToken)
    })

    it('should handle prisma create errors', async () => {
      tokenService.generateRefreshToken.mockReturnValue('token')
      tokenService.hashRefreshToken.mockReturnValue('hash')
      tokenService.getRefreshTokenExpiration.mockReturnValue(new Date())

      const error = new Error('Database error')
      mockCtx.prisma.session.create.mockRejectedValue(error)

      await expect(
        sessionService.createSession({
          userId: 'user-123',
        })
      ).rejects.toThrow('Database error')
    })
  })

  describe('findByRefreshToken', () => {
    it('should find session with user by hashed token', async () => {
      const sessionWithUser = {
        ...mockSession,
        user: mockUser,
      }

      mockCtx.prisma.session.findUnique.mockResolvedValue(sessionWithUser)

      const result = await sessionService.findByRefreshToken('hashed-token-123')

      expect(mockCtx.prisma.session.findUnique).toHaveBeenCalledWith({
        where: { refreshToken: 'hashed-token-123' },
        include: { user: true },
      })

      expect(result).toEqual(sessionWithUser)
    })

    it('should return null if session not found', async () => {
      mockCtx.prisma.session.findUnique.mockResolvedValue(null)

      const result = await sessionService.findByRefreshToken('non-existent-token')

      expect(result).toBeNull()
    })

    it('should handle database errors', async () => {
      const error = new Error('Connection timeout')
      mockCtx.prisma.session.findUnique.mockRejectedValue(error)

      await expect(sessionService.findByRefreshToken('token')).rejects.toThrow('Connection timeout')
    })
  })

  describe('rotateRefreshToken', () => {
    it('should delete old session and create new one', async () => {
      const oldHashedToken = 'old-hashed-token'
      const newRawToken = 'new-raw-token'
      const newHashedToken = 'new-hashed-token'

      tokenService.generateRefreshToken.mockReturnValue(newRawToken)
      tokenService.hashRefreshToken.mockReturnValue(newHashedToken)
      tokenService.getRefreshTokenExpiration.mockReturnValue(new Date())

      mockCtx.prisma.session.delete.mockResolvedValue(mockSession)
      mockCtx.prisma.session.create.mockResolvedValue({
        ...mockSession,
        refreshToken: newHashedToken,
      })

      const result = await sessionService.rotateRefreshToken(oldHashedToken, {
        userId: 'user-123',
        userAgent: 'Chrome',
        ipAddress: '10.0.0.1',
      })

      expect(mockCtx.prisma.session.delete).toHaveBeenCalledWith({
        where: { refreshToken: oldHashedToken },
      })

      expect(mockCtx.prisma.session.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          refreshToken: newHashedToken,
          userAgent: 'Chrome',
          ipAddress: '10.0.0.1',
          expiresAt: expect.any(Date),
        },
      })

      expect(result).toBe(newRawToken)
    })

    it('should throw error if old session not found', async () => {
      mockCtx.prisma.session.delete.mockRejectedValue(new Error('Record not found'))

      await expect(
        sessionService.rotateRefreshToken('non-existent', {
          userId: 'user-123',
        })
      ).rejects.toThrow('Record not found')
    })

    it('should preserve user context during rotation', async () => {
      tokenService.generateRefreshToken.mockReturnValue('new-token')
      tokenService.hashRefreshToken.mockReturnValue('new-hash')
      tokenService.getRefreshTokenExpiration.mockReturnValue(new Date())

      mockCtx.prisma.session.delete.mockResolvedValue(mockSession)
      mockCtx.prisma.session.create.mockResolvedValue(mockSession)

      await sessionService.rotateRefreshToken('old-hash', {
        userId: 'user-456',
        userAgent: 'Safari',
        ipAddress: '192.168.1.100',
      })

      expect(mockCtx.prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-456',
            userAgent: 'Safari',
            ipAddress: '192.168.1.100',
          }),
        })
      )
    })
  })

  describe('deleteByRefreshToken', () => {
    it('should delete session by hashed token', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 1 })

      await sessionService.deleteByRefreshToken('hashed-token-123')

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { refreshToken: 'hashed-token-123' },
      })
    })

    it('should not throw error if session not found', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 0 })

      await expect(sessionService.deleteByRefreshToken('non-existent')).resolves.not.toThrow()
    })

    it('should handle database errors gracefully', async () => {
      mockCtx.prisma.session.deleteMany.mockRejectedValue(new Error('DB error'))

      await expect(sessionService.deleteByRefreshToken('token')).rejects.toThrow('DB error')
    })
  })

  describe('getUserSessions', () => {
    const sessions: Session[] = [
      {
        id: 'session-1',
        userId: 'user-123',
        refreshToken: 'hash-1',
        userAgent: 'Chrome',
        ipAddress: '192.168.1.1',
        expiresAt: new Date(),
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'session-2',
        userId: 'user-123',
        refreshToken: 'hash-2',
        userAgent: 'Firefox',
        ipAddress: '192.168.1.2',
        expiresAt: new Date(),
        createdAt: new Date('2024-01-02'),
      },
    ]

    it('should return all user sessions with current flag', async () => {
      mockCtx.prisma.session.findMany.mockResolvedValue(sessions)

      const result = await sessionService.getUserSessions('user-123', 'hash-1')

      expect(mockCtx.prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
      })

      expect(result).toHaveLength(2)
      expect(result[0]!.current).toBe(true) // hash-1
      expect(result[1]!.current).toBe(false) // hash-2
    })

    it('should return sessions without current flag if no currentTokenHash', async () => {
      mockCtx.prisma.session.findMany.mockResolvedValue(sessions)

      const result = await sessionService.getUserSessions('user-123')

      expect(result).toHaveLength(2)
      expect(result[0]!.current).toBe(false)
      expect(result[1]!.current).toBe(false)
    })

    it('should return empty array if user has no sessions', async () => {
      mockCtx.prisma.session.findMany.mockResolvedValue([])

      const result = await sessionService.getUserSessions('user-no-sessions')

      expect(result).toEqual([])
    })

    it('should map session fields correctly', async () => {
      mockCtx.prisma.session.findMany.mockResolvedValue([sessions[0]!])

      const result = await sessionService.getUserSessions('user-123')

      expect(result[0]).toBeDefined()
      expect(result[0]!).toEqual({
        id: 'session-1',
        userAgent: 'Chrome',
        ipAddress: '192.168.1.1',
        createdAt: expect.any(Date),
        current: false,
      })
    })

    it('should order sessions by creation date descending', async () => {
      mockCtx.prisma.session.findMany.mockResolvedValue(sessions)

      await sessionService.getUserSessions('user-123')

      expect(mockCtx.prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        })
      )
    })
  })

  describe('deleteSession', () => {
    it('should delete specific session for user', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 1 })

      await sessionService.deleteSession('session-123', 'user-123')

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'session-123',
          userId: 'user-123',
        },
      })
    })

    it('should throw NotFoundException if userId mismatch', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 0 })

      await expect(sessionService.deleteSession('session-123', 'wrong-user')).rejects.toThrow(
        NotFoundException
      )

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalled()
    })

    it('should throw NotFoundException for non-existent session', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 0 })

      await expect(sessionService.deleteSession('non-existent', 'user-123')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('deleteOtherSessions', () => {
    it('should delete all sessions except current', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 3 })

      await sessionService.deleteOtherSessions('user-123', 'current-hash')

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          NOT: { refreshToken: 'current-hash' },
        },
      })
    })

    it('should return without error if no other sessions exist', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 0 })

      await expect(
        sessionService.deleteOtherSessions('user-123', 'only-session')
      ).resolves.not.toThrow()
    })

    it('should handle deletion of multiple sessions', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 10 })

      await sessionService.deleteOtherSessions('user-with-many', 'current')

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalled()
    })
  })

  describe('cleanupExpired', () => {
    it('should delete all expired sessions', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 5 })

      await sessionService.cleanupExpired()

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      })
    })

    it('should not throw error if no expired sessions', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 0 })

      await expect(sessionService.cleanupExpired()).resolves.not.toThrow()
    })

    it('should use current time for expiration check', async () => {
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 2 })

      const beforeCleanup = new Date()
      await sessionService.cleanupExpired()
      const afterCleanup = new Date()

      const callArg = mockCtx.prisma.session.deleteMany.mock.calls[0]![0]!
      const expiresAtFilter = callArg.where!.expiresAt as { lt: Date }
      const expiresAtLt = expiresAtFilter.lt

      // Verify that the expiration check uses a date between before and after
      expect(expiresAtLt.getTime()).toBeGreaterThanOrEqual(beforeCleanup.getTime() - 100) // Allow 100ms tolerance
      expect(expiresAtLt.getTime()).toBeLessThanOrEqual(afterCleanup.getTime() + 100)
    })

    it('should handle cleanup errors', async () => {
      mockCtx.prisma.session.deleteMany.mockRejectedValue(new Error('Cleanup failed'))

      await expect(sessionService.cleanupExpired()).rejects.toThrow('Cleanup failed')
    })
  })

  describe('integration - session lifecycle', () => {
    it('should support complete session flow', async () => {
      // Create session
      tokenService.generateRefreshToken.mockReturnValue('raw-token-1')
      tokenService.hashRefreshToken.mockReturnValue('hash-1')
      tokenService.getRefreshTokenExpiration.mockReturnValue(new Date())

      mockCtx.prisma.session.create.mockResolvedValue(mockSession)

      const token1 = await sessionService.createSession({
        userId: 'user-123',
      })

      expect(token1).toBe('raw-token-1')

      // Find session
      const sessionWithUser = {
        ...mockSession,
        user: mockUser,
      } satisfies Session & { user: User }

      mockCtx.prisma.session.findUnique.mockResolvedValue(sessionWithUser)

      const found = await sessionService.findByRefreshToken('hash-1')
      expect(found).toBeDefined()
      expect(found?.user.id).toBe('user-123')

      // Rotate session
      tokenService.generateRefreshToken.mockReturnValue('raw-token-2')
      tokenService.hashRefreshToken.mockReturnValue('hash-2')

      mockCtx.prisma.session.delete.mockResolvedValue(mockSession)
      mockCtx.prisma.session.create.mockResolvedValue({
        ...mockSession,
        refreshToken: 'hash-2',
      })

      const token2 = await sessionService.rotateRefreshToken('hash-1', {
        userId: 'user-123',
      })

      expect(token2).toBe('raw-token-2')

      // Delete session
      mockCtx.prisma.session.deleteMany.mockResolvedValue({ count: 1 })

      await sessionService.deleteByRefreshToken('hash-2')

      expect(mockCtx.prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { refreshToken: 'hash-2' },
      })
    })
  })
})
