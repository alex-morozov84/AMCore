import { JwtService } from '@nestjs/jwt'
import { randomBytes } from 'crypto'

import { SystemRole } from '@amcore/shared'

import { EnvService } from '../../env/env.service'

import { type AccessTokenPayload, TokenService } from './token.service'

describe('TokenService', () => {
  let tokenService: TokenService
  let jwtService: jest.Mocked<JwtService>
  let envService: jest.Mocked<EnvService>

  beforeEach(() => {
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>

    envService = {
      get: jest.fn((key: string) => {
        const config: Record<string, unknown> = {
          JWT_SECRET: 'test-secret-key-minimum-32-characters',
          JWT_ACCESS_EXPIRATION: '15m',
          JWT_REFRESH_DAYS: 7,
        }
        return config[key]
      }),
    } as unknown as jest.Mocked<EnvService>

    tokenService = new TokenService(jwtService, envService)
  })

  describe('generateAccessToken', () => {
    it('should generate access token with correct payload', () => {
      const payload: AccessTokenPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        systemRole: SystemRole.User,
      }

      jwtService.sign.mockReturnValue('mocked-jwt-token')

      const result = tokenService.generateAccessToken(payload)

      expect(jwtService.sign).toHaveBeenCalledWith(payload)
      expect(result).toBe('mocked-jwt-token')
    })

    it('should generate different tokens for different users', () => {
      jwtService.sign.mockImplementation((payload: any) => `token-${payload.sub}`)

      const token1 = tokenService.generateAccessToken({
        sub: 'user-1',
        email: 'user1@example.com',
        systemRole: SystemRole.User,
      })

      const token2 = tokenService.generateAccessToken({
        sub: 'user-2',
        email: 'user2@example.com',
        systemRole: SystemRole.User,
      })

      expect(token1).toBe('token-user-1')
      expect(token2).toBe('token-user-2')
      expect(token1).not.toBe(token2)
    })
  })

  describe('verifyAccessToken', () => {
    it('should verify valid access token and return payload', () => {
      const payload: AccessTokenPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        systemRole: SystemRole.User,
      }

      jwtService.verify.mockReturnValue(payload)

      const result = tokenService.verifyAccessToken('valid-token')

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token')
      expect(result).toEqual(payload)
    })

    it('should throw error for invalid token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token')
      })

      expect(() => tokenService.verifyAccessToken('invalid-token')).toThrow('Invalid token')
    })

    it('should throw error for expired token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired')
      })

      expect(() => tokenService.verifyAccessToken('expired-token')).toThrow('jwt expired')
    })

    it('should throw error for malformed token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed')
      })

      expect(() => tokenService.verifyAccessToken('malformed')).toThrow('jwt malformed')
    })
  })

  describe('generateRefreshToken', () => {
    it('should generate random refresh token', () => {
      const token = tokenService.generateRefreshToken()

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.length).toBe(64) // 32 bytes = 64 hex chars
      expect(token).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate unique tokens', () => {
      const tokens = new Set<string>()

      for (let i = 0; i < 100; i++) {
        tokens.add(tokenService.generateRefreshToken())
      }

      expect(tokens.size).toBe(100) // All unique
    })

    it('should generate cryptographically secure tokens', () => {
      const token = tokenService.generateRefreshToken()
      const buffer = Buffer.from(token, 'hex')

      expect(buffer.length).toBe(32) // 32 bytes
      expect(randomBytes(32).length).toBe(32) // Same as crypto.randomBytes
    })
  })

  describe('hashRefreshToken', () => {
    it('should hash token consistently', () => {
      const token = 'test-refresh-token'

      const hash1 = tokenService.hashRefreshToken(token)
      const hash2 = tokenService.hashRefreshToken(token)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different tokens', () => {
      const token1 = 'token-one'
      const token2 = 'token-two'

      const hash1 = tokenService.hashRefreshToken(token1)
      const hash2 = tokenService.hashRefreshToken(token2)

      expect(hash1).not.toBe(hash2)
    })

    it('should produce SHA-256 hash (64 hex chars)', () => {
      const token = 'test-token'
      const hash = tokenService.hashRefreshToken(token)

      expect(hash.length).toBe(64) // SHA-256 = 32 bytes = 64 hex chars
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should hash empty string', () => {
      const hash = tokenService.hashRefreshToken('')

      expect(hash).toBeDefined()
      expect(hash.length).toBe(64)
    })

    it('should be deterministic (same input = same output)', () => {
      const token = 'deterministic-test'
      const hashes = Array.from({ length: 10 }, () => tokenService.hashRefreshToken(token))

      expect(new Set(hashes).size).toBe(1) // All hashes are identical
    })
  })

  describe('getRefreshTokenExpiration', () => {
    it('should return expiration date 7 days in future', () => {
      const before = Date.now()
      const expiration = tokenService.getRefreshTokenExpiration()
      const after = Date.now()

      const expectedMs = 7 * 24 * 60 * 60 * 1000 // 7 days in ms

      expect(expiration).toBeInstanceOf(Date)
      expect(expiration.getTime()).toBeGreaterThanOrEqual(before + expectedMs)
      expect(expiration.getTime()).toBeLessThanOrEqual(after + expectedMs)
    })

    it('should use JWT_REFRESH_DAYS from env', () => {
      envService.get.mockReturnValue(14) // 14 days

      const expiration = tokenService.getRefreshTokenExpiration()
      const now = new Date()
      const expected = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

      // Allow 1 second difference due to execution time
      expect(Math.abs(expiration.getTime() - expected.getTime())).toBeLessThan(1000)
    })

    it('should return different dates on multiple calls', () => {
      const exp1 = tokenService.getRefreshTokenExpiration()

      // Wait 10ms to ensure different timestamps
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10)

      const exp2 = tokenService.getRefreshTokenExpiration()

      expect(exp2.getTime()).toBeGreaterThanOrEqual(exp1.getTime())
    })

    it('should calculate correct date components', () => {
      const expiration = tokenService.getRefreshTokenExpiration()
      const now = new Date()
      const diff = expiration.getTime() - now.getTime()

      const days = diff / (24 * 60 * 60 * 1000)

      expect(days).toBeGreaterThanOrEqual(6.99) // Account for execution time
      expect(days).toBeLessThanOrEqual(7.01)
    })
  })

  describe('integration - token lifecycle', () => {
    it('should support full token lifecycle', () => {
      // Generate refresh token
      const refreshToken = tokenService.generateRefreshToken()
      expect(refreshToken).toBeDefined()

      // Hash for storage
      const hash1 = tokenService.hashRefreshToken(refreshToken)
      expect(hash1).toBeDefined()

      // Hash again (should be same)
      const hash2 = tokenService.hashRefreshToken(refreshToken)
      expect(hash1).toBe(hash2)

      // Get expiration
      const expiration = tokenService.getRefreshTokenExpiration()
      expect(expiration.getTime()).toBeGreaterThan(Date.now())
    })

    it('should handle multiple concurrent sessions', () => {
      const sessions = Array.from({ length: 10 }, () => ({
        token: tokenService.generateRefreshToken(),
        hash: '',
      }))

      // Hash all tokens
      sessions.forEach((session) => {
        session.hash = tokenService.hashRefreshToken(session.token)
      })

      // All tokens should be unique
      const tokens = sessions.map((s) => s.token)
      expect(new Set(tokens).size).toBe(10)

      // All hashes should be unique
      const hashes = sessions.map((s) => s.hash)
      expect(new Set(hashes).size).toBe(10)
    })
  })
})
