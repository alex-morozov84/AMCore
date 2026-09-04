import { PinoLogger } from 'nestjs-pino'

import type { MetricsService } from '../observability'
import type { AppRedisClient } from '../redis/redis-connection.service'

import { GCRA_SCRIPT, KEY_PREFIX } from './gcra.constants'
import { GcraRedisLimiter } from './gcra-redis-limiter.service'
import type { RateLimitPolicy } from './rate-limit-policies'

const POLICY: RateLimitPolicy = { rate: 5, per: 5000, burst: 3 }

describe('GcraRedisLimiter', () => {
  let limiter: GcraRedisLimiter
  let redis: jest.Mocked<Pick<AppRedisClient, 'eval'>>
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'error'>>
  let metrics: jest.Mocked<Pick<MetricsService, 'incRedisClientEvent'>>

  beforeEach(() => {
    redis = { eval: jest.fn() } as jest.Mocked<Pick<AppRedisClient, 'eval'>>
    logger = { setContext: jest.fn(), error: jest.fn() } as jest.Mocked<
      Pick<PinoLogger, 'setContext' | 'error'>
    >
    metrics = { incRedisClientEvent: jest.fn() }
    limiter = new GcraRedisLimiter(
      redis as unknown as AppRedisClient,
      logger as unknown as PinoLogger,
      metrics as unknown as MetricsService
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('consume (Redis path)', () => {
    it('runs the GCRA script against the namespaced key with rate/period/burst/cost args', async () => {
      redis.eval.mockResolvedValueOnce([1, 2, -1, 1000])

      await limiter.consume('abc', POLICY)

      expect(redis.eval).toHaveBeenCalledWith(GCRA_SCRIPT, {
        keys: [`${KEY_PREFIX}abc`],
        arguments: ['5', '5000', '3', '1'],
      })
    })

    it('resolves burst from the policy when explicit, from rate when omitted', async () => {
      redis.eval.mockResolvedValueOnce([1, 0, -1, 1000])
      await limiter.consume('abc', { rate: 10, per: 60_000 })
      expect(redis.eval).toHaveBeenCalledWith(GCRA_SCRIPT, {
        keys: [`${KEY_PREFIX}abc`],
        arguments: ['10', '60000', '10', '1'],
      })
    })

    it('maps an admitted reply', async () => {
      redis.eval.mockResolvedValueOnce([1, 2, -1, 1000])
      const decision = await limiter.consume('abc', POLICY)
      expect(decision).toEqual({
        allowed: true,
        remaining: 2,
        retryAfterMs: -1,
        resetAfterMs: 1000,
      })
    })

    it('maps a refused reply', async () => {
      redis.eval.mockResolvedValueOnce([0, 0, 850, 3000])
      const decision = await limiter.consume('abc', POLICY)
      expect(decision).toEqual({
        allowed: false,
        remaining: 0,
        retryAfterMs: 850,
        resetAfterMs: 3000,
      })
    })

    it('passes a non-default cost through as the fourth argument', async () => {
      redis.eval.mockResolvedValueOnce([1, 1, -1, 1000])
      await limiter.consume('abc', POLICY, 2)
      expect(redis.eval).toHaveBeenCalledWith(GCRA_SCRIPT, {
        keys: [`${KEY_PREFIX}abc`],
        arguments: ['5', '5000', '3', '2'],
      })
    })
  })

  describe('degradation', () => {
    it('falls back to the local in-memory limiter when Redis errors', async () => {
      redis.eval.mockRejectedValueOnce(new Error('redis down'))

      const decision = await limiter.consume('abc', POLICY)

      expect(decision.allowed).toBe(true)
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('throttler', 'degraded')
    })

    it('falls back when the Redis call exceeds the timeout', async () => {
      jest.useFakeTimers()
      redis.eval.mockReturnValueOnce(new Promise(() => undefined) as Promise<never>)

      const pending = limiter.consume('abc', POLICY)
      await jest.advanceTimersByTimeAsync(150)
      const decision = await pending

      expect(decision.allowed).toBe(true)
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('throttler', 'degraded')
    })

    it('shares one held fallback instance across degraded calls', async () => {
      redis.eval.mockRejectedValue(new Error('redis down'))

      for (let i = 0; i < POLICY.burst!; i++) {
        const decision = await limiter.consume('abc', POLICY)
        expect(decision.allowed).toBe(true)
      }
      // A fresh fallback per call would reset to idle == fail-open past burst.
      const overBurst = await limiter.consume('abc', POLICY)
      expect(overBurst.allowed).toBe(false)
    })

    it('logs every fallback even when degraded logs are debounced', async () => {
      redis.eval.mockRejectedValue(new Error('redis down'))

      await limiter.consume('abc', POLICY)
      await limiter.consume('abc', POLICY)

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(metrics.incRedisClientEvent).toHaveBeenCalledTimes(2)
    })
  })
})
