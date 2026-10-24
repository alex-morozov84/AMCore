import { jest } from '@jest/globals'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import type { PinoLogger } from 'nestjs-pino'

import { aggregateTelegram } from '../src/core/admin/integrations/readers/telegram-reachability.aggregate.js'
import {
  TELEGRAM_REACHABILITY,
  type TelegramObservation,
} from '../src/core/notifications/channels/telegram/telegram-reachability.policy.js'
import { telegramCheckKeys } from '../src/core/notifications/channels/telegram/telegram-reachability.scripts.js'
import {
  readTelegramObservations,
  TelegramReachabilityStore,
} from '../src/core/notifications/channels/telegram/telegram-reachability.store.js'
import type { MetricsService } from '../src/infrastructure/observability/index.js'
import type { AppRedisClient } from '../src/infrastructure/redis/index.js'

import { e2eContainerLabels } from './e2e-owned-containers'

/** The stored shape of the Telegram reachability check against a real Redis 7. */
const BINDING = 'c'.repeat(64)
const metrics = { incRedisClientEvent: jest.fn() } as unknown as MetricsService
const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger

describe('Telegram reachability store (real Redis)', () => {
  let container: StartedRedisContainer
  let client: AppRedisClient
  let store: TelegramReachabilityStore

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    client = createClient({ url: container.getConnectionUrl() })
    await client.connect()
    store = new TelegramReachabilityStore(client, metrics, logger)
    store.open()
    for (let i = 0; i < 50 && (await store.now()) === undefined; i++)
      await new Promise((resolve) => setTimeout(resolve, 100))
  }, 120_000)

  afterAll(async () => {
    await store?.close()
    await client?.quit()
    await container?.stop()
  })

  beforeEach(async () => {
    await client.flushAll()
  })

  async function observation(
    over: Partial<TelegramObservation> = {}
  ): Promise<TelegramObservation> {
    return {
      v: 1,
      binding: BINDING,
      observedAt: (await store.now())!,
      seq: 1,
      result: 'ok',
      failure: null,
      ...over,
    }
  }

  const read = async () => (await readTelegramObservations(client, 1_000))!

  it('stores a result and reads it back in one snapshot with the Redis clock', async () => {
    await expect(store.write('w1', await observation())).resolves.toBe('stored')
    const snapshot = await read()
    expect(snapshot.fields).toHaveLength(1)
    expect(snapshot.overflow).toBeNull()
    expect(Math.abs(snapshot.now - Date.now())).toBeLessThan(5_000)
    const ttl = await client.pTTL(telegramCheckKeys.observations)
    expect(ttl).toBeGreaterThan(TELEGRAM_REACHABILITY.retentionMs - 10_000)
  })

  it('caps the hash at 32 workers, evicts nobody and remembers the overflow', async () => {
    for (let i = 0; i < 32; i++)
      expect(
        await store.write(
          `w${i}`,
          await observation({
            result: i === 0 ? 'failed' : 'ok',
            failure: i === 0 ? 'unreachable' : null,
          })
        )
      ).toBe('stored')
    await expect(store.write('w32', await observation())).resolves.toBe('overflow')
    expect(await client.hLen(telegramCheckKeys.observations)).toBe(32)
    expect(await client.hExists(telegramCheckKeys.observations, 'w0')).toBe(1)
    expect(await client.exists(telegramCheckKeys.overflow)).toBe(1)

    // Later the extra workers stop: only a few successes are left, the row stays unknown.
    for (let i = 0; i < 30; i++) await store.remove(`w${i}`)
    const snapshot = await read()
    expect(snapshot.fields).toHaveLength(2)
    expect(snapshot.overflow).not.toBeNull()
    const { evidence } = aggregateTelegram(snapshot, BINDING, Date.now())
    expect(evidence).toMatchObject({ result: 'unknown', failure: 'too_many_workers' })
    expect(await client.pTTL(telegramCheckKeys.overflow)).toBeGreaterThan(0)
  })

  it('refuses a write that arrives later than 5 s after its observation, or from the future', async () => {
    const now = (await store.now())!
    await expect(store.write('w1', await observation({ observedAt: now - 6_000 }))).resolves.toBe(
      'late'
    )
    await expect(store.write('w1', await observation({ observedAt: now + 6_000 }))).resolves.toBe(
      'late'
    )
    expect(await client.exists(telegramCheckKeys.observations)).toBe(0)
  })

  it('an older completion never overwrites a newer one of the same worker', async () => {
    await store.write('w1', await observation({ seq: 5, result: 'failed', failure: 'timeout' }))
    await expect(store.write('w1', await observation({ seq: 4 }))).resolves.toBe('late')
    await expect(store.write('w1', await observation({ seq: 5 }))).resolves.toBe('late')
    const stored = JSON.parse((await client.hGet(telegramCheckKeys.observations, 'w1'))!)
    expect(stored).toMatchObject({ seq: 5, result: 'failed' })
  })

  it('a late write after a graceful delete cannot bring the worker back', async () => {
    const first = await observation()
    await store.write('w1', first)
    await store.remove('w1')
    await expect(
      store.write('w1', { ...first, seq: 2, observedAt: first.observedAt - 6_000 })
    ).resolves.toBe('late')
    expect(await client.hExists(telegramCheckKeys.observations, 'w1')).toBe(0)
  })

  it('drops results past retention and unreadable values on the next write', async () => {
    const now = (await store.now())!
    const expired = await observation({ observedAt: now - TELEGRAM_REACHABILITY.retentionMs - 1 })
    await client.hSet(telegramCheckKeys.observations, 'old', JSON.stringify(expired))
    await client.hSet(telegramCheckKeys.observations, 'bad', 'not json')
    const before = await read()
    expect(aggregateTelegram(before, BINDING, Date.now()).evidence.failure).toBe(
      'invalid_observation'
    )
    await store.write('w1', await observation())
    expect(await client.hKeys(telegramCheckKeys.observations)).toEqual(['w1'])
  })

  it('concurrent writes, deletes and reads stay within the cap and never throw', async () => {
    const ops = Array.from({ length: 80 }, async (_, i) => {
      if (i % 3 === 0) return store.remove(`w${i % 40}`)
      if (i % 3 === 1) return readTelegramObservations(client, 1_000)
      return store.write(`w${i % 40}`, await observation({ seq: i + 1 }))
    })
    await Promise.all(ops)
    expect(await client.hLen(telegramCheckKeys.observations)).toBeLessThanOrEqual(32)
  })

  it('with Redis away a write fails at once instead of waiting in an offline queue', async () => {
    // Socket options change the inferred client type; the store only needs the app client shape.
    const away = createClient({
      url: 'redis://127.0.0.1:1',
      socket: { reconnectStrategy: false },
    }) as unknown as AppRedisClient
    away.on('error', () => undefined)
    const offline = new TelegramReachabilityStore(away, metrics, logger)
    offline.open()
    const started = Date.now()
    await expect(offline.write('w1', await observation())).resolves.toBe('unavailable')
    await expect(offline.now()).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1_000)
    await offline.close()
  })
})
