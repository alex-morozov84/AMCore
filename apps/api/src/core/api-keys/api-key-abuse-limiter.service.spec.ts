import { HttpStatus } from '@nestjs/common'
import type { Cache } from 'cache-manager'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

import { ApiKeyAbuseLimiterService } from './api-key-abuse-limiter.service'

// AK-07: brute-force protection on api-key verifications.
//
// Tests exercise the public service contract — Redis is mocked via
// cache-manager. The fingerprint helper is a static so it's tested
// without instantiation.

describe('ApiKeyAbuseLimiterService (AK-07)', () => {
  let service: ApiKeyAbuseLimiterService
  let cache: jest.Mocked<Cache>
  let logger: { setContext: jest.Mock; warn: jest.Mock }

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<Cache>
    logger = { setContext: jest.fn(), warn: jest.fn() }
    service = new ApiKeyAbuseLimiterService(cache, logger as never)
  })

  describe('fingerprint()', () => {
    it('produces a deterministic 16-char hex digest', () => {
      const fp = ApiKeyAbuseLimiterService.fingerprint('abc123XYZ_-')
      expect(fp).toMatch(/^[0-9a-f]{16}$/)
      expect(fp).toBe(ApiKeyAbuseLimiterService.fingerprint('abc123XYZ_-'))
    })

    it('different inputs → different fingerprints', () => {
      const a = ApiKeyAbuseLimiterService.fingerprint('aaaaaaaaaaa')
      const b = ApiKeyAbuseLimiterService.fingerprint('aaaaaaaaaab')
      expect(a).not.toBe(b)
    })
  })

  describe('check()', () => {
    it('does not throw when both counters are under the limits', async () => {
      cache.get.mockResolvedValueOnce(10).mockResolvedValueOnce(5)
      await expect(service.check('1.2.3.4', 'fp123')).resolves.toBeUndefined()
    })

    it('does not throw when counters are missing (fresh keys)', async () => {
      cache.get.mockResolvedValue(undefined)
      await expect(service.check('1.2.3.4', 'fp123')).resolves.toBeUndefined()
    })

    it('throws 429 + RATE_LIMIT_EXCEEDED when IP counter is at the limit', async () => {
      cache.get.mockResolvedValueOnce(100).mockResolvedValueOnce(0)

      const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect((err as AppException).errorCode).toBe(AuthErrorCode.RATE_LIMIT_EXCEEDED)
    })

    it('throws 429 + RATE_LIMIT_EXCEEDED when fingerprint counter is at the limit', async () => {
      cache.get.mockResolvedValueOnce(0).mockResolvedValueOnce(20)

      await expect(service.check('1.2.3.4', 'fp123')).rejects.toBeInstanceOf(AppException)
    })

    it('includes retryAfterSeconds in the exception details', async () => {
      cache.get.mockResolvedValueOnce(100).mockResolvedValueOnce(0)

      const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).details).toEqual({ retryAfterSeconds: 3600 })
    })
  })

  describe('consume()', () => {
    it('increments both counters with the rolling TTL', async () => {
      cache.get.mockResolvedValueOnce(5).mockResolvedValueOnce(3)

      await service.consume('1.2.3.4', 'fp123')

      expect(cache.set).toHaveBeenCalledWith('rate:api_key_fail_ip:1.2.3.4', 6, 60 * 60 * 1000)
      expect(cache.set).toHaveBeenCalledWith('rate:api_key_fail_token:fp123', 4, 60 * 60 * 1000)
    })

    it('initializes counters from 0 when missing', async () => {
      cache.get.mockResolvedValue(undefined)

      await service.consume('1.2.3.4', 'fp123')

      expect(cache.set).toHaveBeenCalledWith('rate:api_key_fail_ip:1.2.3.4', 1, expect.any(Number))
      expect(cache.set).toHaveBeenCalledWith('rate:api_key_fail_token:fp123', 1, expect.any(Number))
    })

    it('logs WARN with keyFingerprint and counts; raw shortToken never appears', async () => {
      cache.get.mockResolvedValueOnce(5).mockResolvedValueOnce(3)

      await service.consume('1.2.3.4', 'fp123')

      expect(logger.warn).toHaveBeenCalledTimes(1)
      const [payload, message] = logger.warn.mock.calls[0]!
      expect(payload).toEqual({
        ip: '1.2.3.4',
        keyFingerprint: 'fp123',
        ipCount: 6,
        fpCount: 4,
      })
      expect(payload).not.toHaveProperty('shortToken')
      expect(payload).not.toHaveProperty('longToken')
      expect(message).toBe('Failed API key verification')
    })
  })

  describe('reset()', () => {
    it('clears the fingerprint counter', async () => {
      await service.reset('fp123')
      expect(cache.del).toHaveBeenCalledWith('rate:api_key_fail_token:fp123')
    })

    // Critical: a valid attacker key must not wipe the per-IP failure
    // history of the surrounding bad attempts.
    it('does NOT clear the IP counter', async () => {
      await service.reset('fp123')

      const ipKeyCalls = cache.del.mock.calls.filter(([key]) =>
        String(key).startsWith('rate:api_key_fail_ip:')
      )
      expect(ipKeyCalls).toHaveLength(0)
    })
  })
})
