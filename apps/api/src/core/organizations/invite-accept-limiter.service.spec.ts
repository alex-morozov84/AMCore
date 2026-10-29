import { HttpStatus } from '@nestjs/common'
import type { PinoLogger } from 'nestjs-pino'

import { AppException, ServiceUnavailableException } from '../../common/exceptions'
import { AbuseCounterError, type AbuseCounterStore } from '../../infrastructure/redis'

import { InviteAcceptLimiterService } from './invite-accept-limiter.service'

// The store's Lua, atomicity and refusal cases run against a real Redis in
// abuse-counter.redis.e2e-spec.ts; here the store is mocked.

describe('InviteAcceptLimiterService', () => {
  let service: InviteAcceptLimiterService
  let counters: { read: jest.Mock; increment: jest.Mock; clear: jest.Mock }
  let logger: jest.Mocked<PinoLogger>

  const ip = '203.0.113.5'
  const token = 'random-base64url-token-of-reasonable-length'
  const fingerprint = InviteAcceptLimiterService.fingerprint(token)
  const ipKey = `rate:v2:invite_accept_fail_ip:${ip}`
  const fingerprintKey = `rate:v2:invite_accept_fail_token:${fingerprint}`

  beforeEach(() => {
    counters = { read: jest.fn(), increment: jest.fn(), clear: jest.fn() }
    logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

    service = new InviteAcceptLimiterService(counters as unknown as AbuseCounterStore, logger)
  })

  it('produces deterministic 16-hex-char fingerprint from token', () => {
    const fp = InviteAcceptLimiterService.fingerprint(token)
    expect(fp).toHaveLength(16)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    // Determinism: same input → same output.
    expect(InviteAcceptLimiterService.fingerprint(token)).toBe(fp)
  })

  describe('check', () => {
    it('reads both v2 keys and passes below the limits', async () => {
      counters.read.mockResolvedValue({ ip: 5, subject: 5 })

      await expect(service.check(ip, fingerprint)).resolves.toBeUndefined()

      expect(counters.read).toHaveBeenCalledWith(ipKey, fingerprintKey)
    })

    it('passes for a first attempt', async () => {
      counters.read.mockResolvedValue({ ip: 0, subject: 0 })
      await expect(service.check(ip, fingerprint)).resolves.toBeUndefined()
    })

    it('throws 429 RATE_LIMIT_EXCEEDED when the IP counter is at the limit', async () => {
      counters.read.mockResolvedValue({ ip: 100, subject: 0 })
      const error = await service.check(ip, fingerprint).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppException)
      expect((error as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
    })

    it('throws 429 when the fingerprint counter is at the limit (independent axis)', async () => {
      counters.read.mockResolvedValue({ ip: 0, subject: 20 })
      await expect(service.check(ip, fingerprint)).rejects.toThrow(AppException)
    })

    it('thrown exception carries retryAfterSeconds=3600 detail', async () => {
      counters.read.mockResolvedValue({ ip: 100, subject: 0 })
      const error = await service.check(ip, fingerprint).catch((e: unknown) => e)
      expect((error as AppException).details).toEqual({ retryAfterSeconds: 3600 })
    })

    it('fails closed with 503 when the counters cannot be read', async () => {
      counters.read.mockRejectedValue(new AbuseCounterError('unavailable', 'not_sent'))

      const error = await service.check(ip, fingerprint).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'abuse_counter.check_failed',
          keyClass: 'invite_accept',
          case: 'not_sent',
          inviteFingerprint: fingerprint,
        }),
        expect.any(String)
      )
    })
  })

  describe('consume — records one failed attempt', () => {
    it('increments both counters with the one-hour inactivity expiry', async () => {
      counters.increment.mockResolvedValue({ ip: 4, subject: 4 })

      await service.consume(ip, fingerprint)

      expect(counters.increment).toHaveBeenCalledWith(ipKey, fingerprintKey, 60 * 60 * 1000)
    })

    it('logs WARN with the fingerprint, never with the raw token', async () => {
      counters.increment.mockResolvedValue({ ip: 1, subject: 1 })

      await service.consume(ip, fingerprint)

      expect(logger.warn).toHaveBeenCalledTimes(1)
      const [payload] = logger.warn.mock.calls[0] ?? []
      expect(payload).toEqual(
        expect.objectContaining({ ip, inviteFingerprint: fingerprint, ipCount: 1, fpCount: 1 })
      )
      // Negative assertion: the raw token must never appear in log payloads.
      expect(JSON.stringify(payload)).not.toContain(token)
    })

    it.each(['not_sent', 'unknown'] as const)(
      'answers 503 and logs the %s case when recording fails',
      async (outcome) => {
        counters.increment.mockRejectedValue(new AbuseCounterError('unavailable', outcome))

        await expect(service.consume(ip, fingerprint)).rejects.toBeInstanceOf(
          ServiceUnavailableException
        )

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: 'abuse_counter.record_failed', case: outcome }),
          expect.any(String)
        )
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(token)
      }
    )
  })

  describe('reset', () => {
    it('clears only the fingerprint counter — IP counter is not touched', async () => {
      counters.clear.mockResolvedValue(undefined)

      await service.reset(fingerprint)

      expect(counters.clear).toHaveBeenCalledTimes(1)
      expect(counters.clear).toHaveBeenCalledWith(fingerprintKey)
    })

    it('answers 503 and logs when the clear fails', async () => {
      counters.clear.mockRejectedValue(new AbuseCounterError('unavailable', 'unknown'))

      await expect(service.reset(fingerprint)).rejects.toBeInstanceOf(ServiceUnavailableException)

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'abuse_counter.reset_failed' }),
        expect.any(String)
      )
    })
  })
})
