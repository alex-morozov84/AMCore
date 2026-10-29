import { jest } from '@jest/globals'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import {
  ABUSE_COUNTER_INCREMENT_SCRIPT,
  ABUSE_COUNTER_READ_SCRIPT,
} from '../src/infrastructure/redis/abuse-counter.lua'
import {
  AbuseCounterError,
  AbuseCounterStore,
} from '../src/infrastructure/redis/abuse-counter.store'
import { BoundedRedis } from '../src/infrastructure/redis/bounded-redis'
import type { AppRedisClient } from '../src/infrastructure/redis/redis-connection.service'

import { e2eContainerLabels } from './e2e-owned-containers'
import type { RedisConnection } from './test-redis'

const IP = 'rate:v2:test_ip:203.0.113.1'
const SUBJECT = 'rate:v2:test_subject:fp'
const TTL = 3_600_000
// The script ceiling: 10^15, below the range where the client stops decoding replies exactly.
const CEILING = 1_000_000_000_000_000

type Client = RedisConnection
const open = (url: string): Client => createClient({ url, RESP: 2 })

describe('AbuseCounterStore against Redis 7', () => {
  let broker: StartedRedisContainer
  let clients: Client[]
  let raw: Client
  let first: AbuseCounterStore
  let second: AbuseCounterStore

  const connect = async (): Promise<Client> => {
    const client = open(broker.getConnectionUrl())
    client.on('error', () => undefined)
    await client.connect()
    clients.push(client)
    return client
  }
  const storeOn = (client: Client): AbuseCounterStore =>
    new AbuseCounterStore(new BoundedRedis(client as unknown as AppRedisClient))
  const failure = async (promise: Promise<unknown>): Promise<AbuseCounterError> => {
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AbuseCounterError)
    return error as AbuseCounterError
  }

  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    clients = []
    raw = await connect()
    first = storeOn(await connect())
    second = storeOn(await connect())
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    await raw.flushDb()
  })
  afterAll(async () => {
    for (const client of clients) if (client.isOpen) await client.quit()
    await broker?.stop()
  }, 60000)

  describe('counting', () => {
    it('creates plain integer counters with the requested expiry', async () => {
      await expect(first.increment(IP, SUBJECT, TTL)).resolves.toEqual({ ip: 1, subject: 1 })

      expect(await raw.get(IP)).toBe('1')
      expect(await raw.get(SUBJECT)).toBe('1')
      for (const key of [IP, SUBJECT]) {
        const ttl = await raw.pTTL(key)
        expect(ttl).toBeGreaterThan(TTL - 5000)
        expect(ttl).toBeLessThanOrEqual(TTL)
      }
    })

    it('continues from existing integers on both keys independently', async () => {
      await raw.set(IP, '41', { expiration: { type: 'PX', value: 100000 } })
      await raw.set(SUBJECT, '2', { expiration: { type: 'PX', value: 100000 } })

      await expect(first.increment(IP, SUBJECT, TTL)).resolves.toEqual({ ip: 42, subject: 3 })
    })

    it('records exact totals from independent clients under concurrency', async () => {
      // 30 concurrent calls per store stay below the helper capacity; ten rounds.
      for (let round = 0; round < 10; round++)
        await Promise.all(
          Array.from({ length: 60 }, (_, i) => (i % 2 ? first : second).increment(IP, SUBJECT, TTL))
        )

      expect(await raw.get(IP)).toBe('600')
      expect(await raw.get(SUBJECT)).toBe('600')
      await expect(first.read(IP, SUBJECT)).resolves.toEqual({ ip: 600, subject: 600 })
    })

    it('renews both expiries on increment and none on read', async () => {
      await first.increment(IP, SUBJECT, TTL)
      await raw.pExpire(IP, 60000)
      await raw.pExpire(SUBJECT, 60000)

      await first.read(IP, SUBJECT)
      expect(await raw.pTTL(IP)).toBeLessThanOrEqual(60000)
      expect(await raw.pTTL(SUBJECT)).toBeLessThanOrEqual(60000)

      await first.increment(IP, SUBJECT, TTL)
      expect(await raw.pTTL(IP)).toBeGreaterThan(TTL - 5000)
      expect(await raw.pTTL(SUBJECT)).toBeGreaterThan(TTL - 5000)
    })

    it('reads absent keys as zero without creating them', async () => {
      await expect(first.read(IP, SUBJECT)).resolves.toEqual({ ip: 0, subject: 0 })

      expect(await raw.keys('*')).toEqual([])
    })
  })

  describe('clear', () => {
    it('removes only the subject key and leaves the IP counter and its expiry', async () => {
      await first.increment(IP, SUBJECT, TTL)
      await first.increment(IP, SUBJECT, TTL)
      const ipTtl = await raw.pTTL(IP)

      await first.clear(SUBJECT)

      expect(await raw.get(SUBJECT)).toBeNull()
      expect(await raw.get(IP)).toBe('2')
      expect(await raw.pTTL(IP)).toBeLessThanOrEqual(ipTtl)
    })

    it('a late clear erases a newer subject increment but never the IP debt (documented limit)', async () => {
      await first.increment(IP, SUBJECT, TTL)
      // Another instance records a failure, then the earlier success-driven clear lands.
      await second.increment(IP, SUBJECT, TTL)
      await first.clear(SUBJECT)

      await expect(first.read(IP, SUBJECT)).resolves.toEqual({ ip: 2, subject: 0 })
    })
  })

  describe('refusals leave both keys untouched', () => {
    const bad = [
      ['non-canonical leading zero', '007'],
      ['fraction', '1.5'],
      ['negative', '-1'],
      ['exponent', '1e3'],
      ['leading space', ' 1'],
      ['empty', ''],
      ['over 16 digits', '1'.repeat(17)],
      ['above the counter ceiling', String(CEILING + 1)],
      ['JSON envelope from the removed stack', '{"value":3,"expires":9999999999999}'],
    ] as const

    const snapshot = async (): Promise<unknown[]> => [
      await raw.type(IP),
      await raw.type(SUBJECT),
      await raw.get(IP).catch(() => 'not-a-string'),
      await raw.get(SUBJECT).catch(() => 'not-a-string'),
      await raw.pTTL(IP),
      await raw.pTTL(SUBJECT),
    ]

    it.each(bad)('rejects %s in the SECOND key; increment writes nothing', async (_name, value) => {
      await raw.set(IP, '5', { expiration: { type: 'PX', value: 100000 } })
      await raw.set(SUBJECT, value, { expiration: { type: 'PX', value: 100000 } })
      const before = await snapshot()

      expect(await failure(first.increment(IP, SUBJECT, TTL))).toMatchObject({
        kind: 'invalid_state',
        outcome: 'not_sent',
      })

      const after = await snapshot()
      expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
      expect(await raw.get(IP)).toBe('5')
    })

    it.each(bad)('rejects %s in the FIRST key; read and increment refuse', async (_name, value) => {
      await raw.set(SUBJECT, '5', { expiration: { type: 'PX', value: 100000 } })
      await raw.set(IP, value, { expiration: { type: 'PX', value: 100000 } })

      expect(await failure(first.read(IP, SUBJECT))).toMatchObject({ kind: 'invalid_state' })
      expect(await failure(first.increment(IP, SUBJECT, TTL))).toMatchObject({
        kind: 'invalid_state',
      })
      expect(await raw.get(SUBJECT)).toBe('5')
    })

    it.each([
      ['list', async (key: string) => void (await raw.rPush(key, 'x'))],
      ['hash', async (key: string) => void (await raw.hSet(key, 'f', 'v'))],
      ['set', async (key: string) => void (await raw.sAdd(key, 'm'))],
    ])(
      'a %s under a counter key is an error, never zero, in read and increment',
      async (_type, create) => {
        await create(SUBJECT)
        await raw.set(IP, '1', { expiration: { type: 'PX', value: 100000 } })

        expect(await failure(first.read(IP, SUBJECT))).toMatchObject({ kind: 'invalid_state' })
        expect(await failure(first.read(SUBJECT, IP))).toMatchObject({ kind: 'invalid_state' })
        expect(await failure(first.increment(IP, SUBJECT, TTL))).toMatchObject({
          kind: 'invalid_state',
        })
        expect(await raw.get(IP)).toBe('1')
      }
    )

    it('refuses a live counter without an expiry in either position', async () => {
      await raw.set(IP, '3')
      await raw.set(SUBJECT, '1', { expiration: { type: 'PX', value: 100000 } })

      expect(await failure(first.read(IP, SUBJECT))).toMatchObject({ kind: 'invalid_state' })
      expect(await failure(first.increment(SUBJECT, IP, TTL))).toMatchObject({
        kind: 'invalid_state',
      })
      expect(await raw.get(SUBJECT)).toBe('1')
      expect(await raw.pTTL(IP)).toBe(-1)
    })

    it('refuses an increment that would pass the counter ceiling, in either key', async () => {
      await raw.set(IP, String(CEILING), { expiration: { type: 'PX', value: 100000 } })
      await raw.set(SUBJECT, '1', { expiration: { type: 'PX', value: 100000 } })

      expect(await failure(first.increment(IP, SUBJECT, TTL))).toMatchObject({
        kind: 'invalid_state',
      })
      expect(await failure(first.increment(SUBJECT, IP, TTL))).toMatchObject({
        kind: 'invalid_state',
      })
      expect(await raw.get(SUBJECT)).toBe('1')
      await expect(first.read(IP, SUBJECT)).resolves.toEqual({ ip: CEILING, subject: 1 })
    })

    it('script argument checks: identical keys, bad expiry, wrong counts write nothing', async () => {
      const run = async (keys: string[], args: string[]): Promise<unknown> =>
        raw.eval(ABUSE_COUNTER_INCREMENT_SCRIPT, { keys, arguments: args })

      expect(await run([IP, IP], ['1000'])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], ['0'])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], ['1.5'])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], ['86400001'])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], ['x'])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], [])).toEqual([-1, -1])
      expect(await run([IP, SUBJECT], ['1000', 'extra'])).toEqual([-1, -1])
      expect(await run([IP], ['1000'])).toEqual([-1, -1])
      expect(await raw.eval(ABUSE_COUNTER_READ_SCRIPT, { keys: [IP, IP], arguments: [] })).toEqual([
        -1, -1,
      ])
      expect(await raw.keys('*')).toEqual([])
    })
  })
})
