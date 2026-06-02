import { PinoLogger } from 'nestjs-pino'

import type { AppRedisClient } from '../redis/redis-connection.service'

import { INCREMENT_SCRIPT, KEY_PREFIX } from './redis-throttler-storage.constants'
import { RedisThrottlerStorage } from './redis-throttler-storage.service'

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage
  let redis: jest.Mocked<Pick<AppRedisClient, 'eval'>>
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'error'>>

  beforeEach(() => {
    redis = { eval: jest.fn() } as jest.Mocked<Pick<AppRedisClient, 'eval'>>
    logger = { setContext: jest.fn(), error: jest.fn() } as jest.Mocked<
      Pick<PinoLogger, 'setContext' | 'error'>
    >
    storage = new RedisThrottlerStorage(
      redis as unknown as AppRedisClient,
      logger as unknown as PinoLogger
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('increment (Redis path)', () => {
    it('runs the Lua script against namespaced counter and block keys', async () => {
      redis.eval.mockResolvedValueOnce([1, 1000, 0, 0])

      await storage.increment('abc', 1000, 10, 1000, 'long')

      expect(redis.eval).toHaveBeenCalledWith(INCREMENT_SCRIPT, {
        keys: [`${KEY_PREFIX}long:abc`, `${KEY_PREFIX}long:abc:block`],
        arguments: ['1000', '10', '1000'],
      })
    })

    it('maps a non-blocked reply to the v6 storage record', async () => {
      redis.eval.mockResolvedValueOnce([3, 1000, 0, 0])

      const record = await storage.increment('abc', 1000, 10, 1000, 'long')

      expect(record).toEqual({
        totalHits: 3,
        timeToExpire: 1,
        isBlocked: false,
        timeToBlockExpire: 0,
      })
    })

    it('maps a blocked reply with seconds-based expiry', async () => {
      redis.eval.mockResolvedValueOnce([11, 60000, 1, 60000])

      const record = await storage.increment('abc', 60000, 10, 60000, 'long')

      expect(record.isBlocked).toBe(true)
      expect(record.timeToBlockExpire).toBe(60)
    })

    it('converts sub-second PTTL using ceiling semantics', async () => {
      redis.eval.mockResolvedValueOnce([1, 1500, 0, 0])

      const record = await storage.increment('abc', 2000, 10, 2000, 'short')

      expect(record.timeToExpire).toBe(2)
    })
  })

  describe('degradation', () => {
    it('falls back to local in-memory limits when Redis errors', async () => {
      redis.eval.mockRejectedValueOnce(new Error('redis down'))

      const record = await storage.increment('abc', 1000, 10, 1000, 'long')

      expect(record.totalHits).toBe(1)
      expect(record.isBlocked).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
    })

    it('falls back when the Redis call exceeds the timeout', async () => {
      jest.useFakeTimers()
      redis.eval.mockReturnValueOnce(new Promise(() => undefined) as Promise<never>)

      const pending = storage.increment('abc', 1000, 10, 1000, 'long')
      await jest.advanceTimersByTimeAsync(150)
      const record = await pending

      expect(record.totalHits).toBe(1)
      expect(logger.error).toHaveBeenCalledTimes(1)
    })

    it('shares one held fallback instance across degraded calls', async () => {
      redis.eval.mockRejectedValue(new Error('redis down'))

      const first = await storage.increment('abc', 1000, 10, 1000, 'long')
      const second = await storage.increment('abc', 1000, 10, 1000, 'long')

      // A fresh fallback per call would reset to 1 == fail-open.
      expect(first.totalHits).toBe(1)
      expect(second.totalHits).toBe(2)
    })
  })
})
