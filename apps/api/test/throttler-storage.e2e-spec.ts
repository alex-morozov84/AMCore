import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { PinoLogger } from 'nestjs-pino'

import { RedisThrottlerStorage } from '../src/infrastructure/throttling'

type RedisClient = ReturnType<typeof createClient>

const noopLogger = {
  setContext: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger

/**
 * Storage-boundary e2e for the Redis throttler. Uses only a real Redis
 * container (no full Nest app) to prove the behaviours that need a real Redis:
 * shared multi-instance counters, the active-block no-increment/no-extend
 * semantics, fixed-window reset, and scoped key cleanup.
 */
describe('RedisThrottlerStorage (e2e, real Redis)', () => {
  let container: StartedRedisContainer
  let client: RedisClient
  let storage: RedisThrottlerStorage

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    client = createClient({ url: container.getConnectionUrl() })
    await client.connect()
    storage = new RedisThrottlerStorage(client as never, noopLogger)
  }, 120000)

  afterAll(async () => {
    await client.quit()
    await container.stop({ timeout: 10000 })
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }, 120000)

  beforeEach(async () => {
    await storage.reset()
  })

  it('increments a fixed-window counter and sets TTL on the first hit', async () => {
    const record = await storage.increment('k', 1000, 5, 1000, 'long')

    expect(record.totalHits).toBe(1)
    expect(record.isBlocked).toBe(false)
    expect(record.timeToExpire).toBeGreaterThan(0)
    expect(record.timeToExpire).toBeLessThanOrEqual(1)
  })

  it('blocks on limit+1 and does not count further hits while blocked', async () => {
    const ttl = 60000
    const limit = 3

    for (let i = 0; i < limit; i++) {
      const ok = await storage.increment('k', ttl, limit, ttl, 'long')
      expect(ok.isBlocked).toBe(false)
    }

    const blocked = await storage.increment('k', ttl, limit, ttl, 'long')
    expect(blocked.isBlocked).toBe(true)
    expect(blocked.totalHits).toBe(limit + 1)

    // Blocked calls must not increment the counter (Round-2 R2-3).
    const stillBlocked = await storage.increment('k', ttl, limit, ttl, 'long')
    expect(stillBlocked.isBlocked).toBe(true)
    expect(stillBlocked.totalHits).toBe(limit + 1)
  })

  it('allows fresh hits again after the window/block expires', async () => {
    const window = 500

    await storage.increment('k', window, 1, window, 'long') // hit 1: allowed
    const blocked = await storage.increment('k', window, 1, window, 'long') // hit 2: blocked
    expect(blocked.isBlocked).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 700))

    const afterExpiry = await storage.increment('k', window, 1, window, 'long')
    expect(afterExpiry.isBlocked).toBe(false)
    expect(afterExpiry.totalHits).toBe(1)
  })

  it('resets the window after a shorter block expires (blockDuration < ttl)', async () => {
    const ttl = 60000
    const block = 500

    await storage.increment('k', ttl, 1, block, 'long') // hit 1: allowed
    const blocked = await storage.increment('k', ttl, 1, block, 'long') // hit 2: blocked
    expect(blocked.isBlocked).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 700))

    // Block elapsed: the next hit must start a fresh window, not re-block against
    // a still-over-limit counter (matches v6 in-memory totalHits reset).
    const afterBlock = await storage.increment('k', ttl, 1, block, 'long')
    expect(afterBlock.isBlocked).toBe(false)
    expect(afterBlock.totalHits).toBe(1)
  })

  it('honors a longer block without extending the counter window (blockDuration > ttl)', async () => {
    const ttl = 500
    const block = 60000

    await storage.increment('k', ttl, 1, block, 'long') // hit 1: allowed
    const blocked = await storage.increment('k', ttl, 1, block, 'long') // hit 2: blocked

    expect(blocked.isBlocked).toBe(true)
    // Block penalty honored at full duration...
    expect(blocked.timeToBlockExpire).toBe(60)
    // ...but the counter must not be extended past its original fixed window.
    expect(blocked.timeToExpire).toBeLessThanOrEqual(1)
  })

  it('shares counters across two storage instances over the same Redis', async () => {
    const second = new RedisThrottlerStorage(client as never, noopLogger)

    await storage.increment('shared', 60000, 10, 60000, 'long')
    const fromSecond = await second.increment('shared', 60000, 10, 60000, 'long')

    // Proves storage is not process-local at the component boundary.
    expect(fromSecond.totalHits).toBe(2)
  })

  it('reset() deletes only throttle:v1:* keys', async () => {
    await client.set('cache:keep', '1')
    await storage.increment('k', 60000, 10, 60000, 'long')

    await storage.reset()

    expect(await client.get('cache:keep')).toBe('1')
    expect(await client.keys('throttle:v1:*')).toHaveLength(0)
  })
})
