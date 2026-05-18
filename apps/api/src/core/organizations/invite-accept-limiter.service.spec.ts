import type { Cache } from 'cache-manager'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { AppException } from '../../common/exceptions'

import { InviteAcceptLimiterService } from './invite-accept-limiter.service'

describe('InviteAcceptLimiterService', () => {
  let service: InviteAcceptLimiterService
  let cache: DeepMockProxy<Cache>
  let logger: jest.Mocked<PinoLogger>

  const ip = '203.0.113.5'
  const token = 'random-base64url-token-of-reasonable-length'
  const fingerprint = InviteAcceptLimiterService.fingerprint(token)

  beforeEach(() => {
    cache = mockDeep<Cache>()
    logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new InviteAcceptLimiterService(cache as unknown as Cache, logger)
  })

  it('produces deterministic 16-hex-char fingerprint from token', () => {
    const fp = InviteAcceptLimiterService.fingerprint(token)
    expect(fp).toHaveLength(16)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    // Determinism: same input → same output.
    expect(InviteAcceptLimiterService.fingerprint(token)).toBe(fp)
  })

  describe('check', () => {
    it('passes when both counters are below their limits', async () => {
      cache.get.mockResolvedValue(5)
      await expect(service.check(ip, fingerprint)).resolves.toBeUndefined()
    })

    it('passes when counters are absent (first attempt)', async () => {
      cache.get.mockResolvedValue(undefined as unknown as number)
      await expect(service.check(ip, fingerprint)).resolves.toBeUndefined()
    })

    it('throws 429 RATE_LIMIT_EXCEEDED when IP counter is at limit', async () => {
      cache.get.mockImplementation(async <T>(key: string) => {
        if (typeof key === 'string' && key.startsWith('rate:invite_accept_fail_ip:')) {
          return 100 as T
        }
        return 0 as T
      })
      await expect(service.check(ip, fingerprint)).rejects.toThrow(AppException)
    })

    it('throws 429 when fingerprint counter is at limit (independent axis)', async () => {
      cache.get.mockImplementation(async <T>(key: string) => {
        if (typeof key === 'string' && key.startsWith('rate:invite_accept_fail_token:')) {
          return 20 as T
        }
        return 0 as T
      })
      await expect(service.check(ip, fingerprint)).rejects.toThrow(AppException)
    })

    it('thrown exception carries retryAfterSeconds=3600 detail', async () => {
      cache.get.mockResolvedValue(100)
      const error = await service.check(ip, fingerprint).catch((e) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error.details).toEqual({ retryAfterSeconds: 3600 })
    })
  })

  describe('consume', () => {
    it('increments both counters with the documented TTL', async () => {
      cache.get.mockResolvedValue(3)
      await service.consume(ip, fingerprint)

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining(`rate:invite_accept_fail_ip:${ip}`),
        4,
        60 * 60 * 1000
      )
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining(`rate:invite_accept_fail_token:${fingerprint}`),
        4,
        60 * 60 * 1000
      )
    })

    it('logs WARN with the fingerprint, never with the raw token', async () => {
      cache.get.mockResolvedValue(0)
      await service.consume(ip, fingerprint)

      expect(logger.warn).toHaveBeenCalledTimes(1)
      const [payload] = logger.warn.mock.calls[0] ?? []
      expect(payload).toEqual(
        expect.objectContaining({ ip, inviteFingerprint: fingerprint, ipCount: 1, fpCount: 1 })
      )
      // Negative assertion: the raw token must never appear in log payloads.
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(token)
    })
  })

  describe('reset', () => {
    it('clears only the fingerprint counter — IP counter is not touched', async () => {
      await service.reset(fingerprint)
      expect(cache.del).toHaveBeenCalledTimes(1)
      expect(cache.del).toHaveBeenCalledWith(
        expect.stringContaining(`rate:invite_accept_fail_token:${fingerprint}`)
      )
      const calls = cache.del.mock.calls
      const sawIpKey = calls.some(
        ([key]) => typeof key === 'string' && key.startsWith('rate:invite_accept_fail_ip:')
      )
      expect(sawIpKey).toBe(false)
    })
  })
})
