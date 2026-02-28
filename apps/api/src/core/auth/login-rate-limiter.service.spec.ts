import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

import { LoginRateLimiterService } from './login-rate-limiter.service'

describe('LoginRateLimiterService', () => {
  let service: LoginRateLimiterService
  let mockCache: { get: jest.Mock; set: jest.Mock; del: jest.Mock }

  const email = 'test@example.com'
  const ip = '192.168.1.1'

  beforeEach(() => {
    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    }

    service = new LoginRateLimiterService(mockCache as never)
  })

  describe('check', () => {
    it('should pass when no limits are hit', async () => {
      await expect(service.check(email, ip)).resolves.not.toThrow()
    })

    it('should throw 429 when blocked key is set', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('rate:login_blocked') ? Promise.resolve(1) : Promise.resolve(null)
      )

      const err = await service.check(email, ip).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect(((err as AppException).getResponse() as Record<string, unknown>).errorCode).toBe(
        AuthErrorCode.RATE_LIMIT_EXCEEDED
      )
      expect(
        ((err as AppException).getResponse() as Record<string, unknown>).details
      ).toMatchObject({ retryAfterSeconds: 900 })
    })

    it('should throw 429 when per-IP count reaches limit', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('rate:login_ip') ? Promise.resolve(100) : Promise.resolve(null)
      )

      const err = await service.check(email, ip).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect(
        ((err as AppException).getResponse() as Record<string, unknown>).details
      ).toMatchObject({ retryAfterSeconds: 86400 })
    })

    it('should not throw when per-IP count is below limit', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('rate:login_ip') ? Promise.resolve(99) : Promise.resolve(null)
      )

      await expect(service.check(email, ip)).resolves.not.toThrow()
    })
  })

  describe('consume', () => {
    it('should increment both counters on failure', async () => {
      mockCache.get.mockResolvedValue(null)

      await service.consume(email, ip)

      expect(mockCache.set).toHaveBeenCalledWith(`rate:login_ip:${ip}`, 1, expect.any(Number))
      expect(mockCache.set).toHaveBeenCalledWith(
        `rate:login_user_ip:${email}:${ip}`,
        1,
        expect.any(Number)
      )
    })

    it('should set block key after 5 user+IP failures', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('rate:login_user_ip') ? Promise.resolve(4) : Promise.resolve(null)
      )

      await service.consume(email, ip)

      expect(mockCache.set).toHaveBeenCalledWith(
        `rate:login_blocked:${email}:${ip}`,
        1,
        15 * 60 * 1000
      )
    })

    it('should not set block key before 5 user+IP failures', async () => {
      mockCache.get.mockImplementation((key: string) =>
        key.startsWith('rate:login_user_ip') ? Promise.resolve(3) : Promise.resolve(null)
      )

      await service.consume(email, ip)

      expect(mockCache.set).not.toHaveBeenCalledWith(
        expect.stringContaining('blocked'),
        expect.anything(),
        expect.anything()
      )
    })
  })

  describe('reset', () => {
    it('should delete all three keys on successful login', async () => {
      await service.reset(email, ip)

      expect(mockCache.del).toHaveBeenCalledWith(`rate:login_ip:${ip}`)
      expect(mockCache.del).toHaveBeenCalledWith(`rate:login_user_ip:${email}:${ip}`)
      expect(mockCache.del).toHaveBeenCalledWith(`rate:login_blocked:${email}:${ip}`)
    })
  })
})
