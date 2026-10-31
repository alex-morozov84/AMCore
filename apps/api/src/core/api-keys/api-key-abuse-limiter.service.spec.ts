import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../common/exceptions'
import { AbuseCounterError, type AbuseCounterStore } from '../../infrastructure/redis'

import { ApiKeyAbuseLimiterService } from './api-key-abuse-limiter.service'

// AK-07: brute-force protection on api-key verifications.
//
// Tests exercise the public service contract with a mocked counter store; the store's
// Lua, atomicity and refusal cases are proven against a real Redis in
// abuse-counter.redis.e2e-spec.ts. The fingerprint helper is a static so it's tested
// without instantiation.

describe('ApiKeyAbuseLimiterService (AK-07)', () => {
  let service: ApiKeyAbuseLimiterService
  let counters: { read: jest.Mock; increment: jest.Mock; clear: jest.Mock }
  let logger: { setContext: jest.Mock; warn: jest.Mock }

  beforeEach(() => {
    counters = { read: jest.fn(), increment: jest.fn(), clear: jest.fn() }
    logger = { setContext: jest.fn(), warn: jest.fn() }
    service = new ApiKeyAbuseLimiterService(
      counters as unknown as AbuseCounterStore,
      logger as never
    )
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
    it('reads both v2 keys and does not throw under the limits', async () => {
      counters.read.mockResolvedValue({ ip: 10, subject: 5 })

      await expect(service.check('1.2.3.4', 'fp123')).resolves.toBeUndefined()

      expect(counters.read).toHaveBeenCalledWith(
        'rate:v2:api_key_fail_ip:1.2.3.4',
        'rate:v2:api_key_fail_token:fp123',
        250
      )
    })

    it('does not throw for fresh keys', async () => {
      counters.read.mockResolvedValue({ ip: 0, subject: 0 })
      await expect(service.check('1.2.3.4', 'fp123')).resolves.toBeUndefined()
    })

    it('throws 429 + RATE_LIMIT_EXCEEDED when IP counter is at the limit', async () => {
      counters.read.mockResolvedValue({ ip: 100, subject: 0 })

      const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(AppException)
      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
      expect((err as AppException).errorCode).toBe(AuthErrorCode.RATE_LIMIT_EXCEEDED)
    })

    it('throws 429 when the fingerprint counter is at the limit', async () => {
      counters.read.mockResolvedValue({ ip: 0, subject: 20 })

      const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

      expect((err as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
    })

    it('includes retryAfterSeconds in the exception details', async () => {
      counters.read.mockResolvedValue({ ip: 100, subject: 0 })

      const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

      expect((err as AppException).details).toEqual({ retryAfterSeconds: 3600 })
    })

    it.each([
      ['unavailable', 'unknown'],
      ['unavailable', 'not_sent'],
      ['invalid_state', 'not_sent'],
    ] as const)(
      'fails closed with 503 on %s/%s, never reading the state as zero',
      async (kind, outcome) => {
        counters.read.mockRejectedValue(new AbuseCounterError(kind, outcome))

        const err = await service.check('1.2.3.4', 'fp123').catch((e: unknown) => e)

        expect(err).toBeInstanceOf(ServiceUnavailableException)
        expect((err as AppException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
        expect((err as AppException).errorCode).toBe('SERVICE_UNAVAILABLE')
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'abuse_counter.check_failed',
            keyClass: 'api_key',
            case: outcome,
            reason: kind,
            keyFingerprint: 'fp123',
          }),
          expect.any(String)
        )
      }
    )

    it('rethrows errors that are not counter failures', async () => {
      counters.read.mockRejectedValue(new TypeError('bug'))
      await expect(service.check('1.2.3.4', 'fp123')).rejects.toBeInstanceOf(TypeError)
    })
  })

  describe('consume() — records one failed attempt', () => {
    it('increments both v2 counters with the one-hour inactivity expiry', async () => {
      counters.increment.mockResolvedValue({ ip: 6, subject: 4 })

      await service.consume('1.2.3.4', 'fp123')

      expect(counters.increment).toHaveBeenCalledWith(
        'rate:v2:api_key_fail_ip:1.2.3.4',
        'rate:v2:api_key_fail_token:fp123',
        60 * 60 * 1000,
        250
      )
    })

    it('logs WARN with keyFingerprint and counts; raw shortToken never appears', async () => {
      counters.increment.mockResolvedValue({ ip: 6, subject: 4 })

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

    it.each(['not_sent', 'unknown'] as const)(
      'answers 503 and logs the %s case when recording fails',
      async (outcome) => {
        counters.increment.mockRejectedValue(new AbuseCounterError('unavailable', outcome))

        await expect(service.consume('1.2.3.4', 'fp123')).rejects.toBeInstanceOf(
          ServiceUnavailableException
        )

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'abuse_counter.record_failed',
            case: outcome,
            keyFingerprint: 'fp123',
          }),
          expect.any(String)
        )
      }
    )

    it('never puts the IP address or a token in the failure event', async () => {
      counters.increment.mockRejectedValue(new AbuseCounterError('unavailable', 'unknown'))

      await service.consume('203.0.113.9', 'fp123').catch(() => undefined)

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('203.0.113.9')
    })
  })

  describe('reset()', () => {
    it('clears only the fingerprint counter', async () => {
      counters.clear.mockResolvedValue(undefined)

      await service.reset('fp123')

      expect(counters.clear).toHaveBeenCalledTimes(1)
      expect(counters.clear).toHaveBeenCalledWith('rate:v2:api_key_fail_token:fp123', 250)
    })

    // Critical: a valid attacker key must not wipe the per-IP failure
    // history of the surrounding bad attempts.
    it('does NOT touch the IP counter', async () => {
      await service.reset('fp123')

      const touched = counters.clear.mock.calls.map(([key]) => String(key))
      expect(touched.some((key) => key.startsWith('rate:v2:api_key_fail_ip:'))).toBe(false)
    })

    it('answers 503 and logs when the clear fails', async () => {
      counters.clear.mockRejectedValue(new AbuseCounterError('unavailable', 'unknown'))

      await expect(service.reset('fp123')).rejects.toBeInstanceOf(ServiceUnavailableException)

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'abuse_counter.reset_failed' }),
        expect.any(String)
      )
    })
  })
})
