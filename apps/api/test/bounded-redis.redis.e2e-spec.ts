import { setTimeout as sleep } from 'node:timers/promises'

import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { AbuseCounterStore } from '../src/infrastructure/redis/abuse-counter.store'
import {
  BOUNDED_REDIS_DEADLINE_MS,
  BOUNDED_REDIS_STALLED_CAPACITY,
  BoundedRedis,
} from '../src/infrastructure/redis/bounded-redis'
import type { AppRedisClient } from '../src/infrastructure/redis/redis-connection.service'

import { e2eContainerLabels } from './e2e-owned-containers'
import { redisTransportStall } from './fixtures/redis-transport-stall'
import type { RedisConnection } from './test-redis'

const IP = 'rate:v2:stall_ip:203.0.113.2'
const SUBJECT = 'rate:v2:stall_subject:fp'
const TTL = 3_600_000
const SLACK_MS = 750

type Client = RedisConnection
const open = (url: string): Client =>
  createClient({
    url,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 250) },
  })

// The suite-owned TCP fixture sits between the client and a real Redis. With replies held,
// the server executes each command exactly once but the client never sees the answer: the
// state in which node-redis has already dropped its own abort and timeout listeners.
describe('BoundedRedis against a real server with a stalled transport', () => {
  let broker: StartedRedisContainer
  let raw: Client
  let proxy: Awaited<ReturnType<typeof redisTransportStall>>
  let client: Client
  let store: AbuseCounterStore

  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    raw = open(broker.getConnectionUrl())
    raw.on('error', () => undefined)
    await raw.connect()
  }, 120000)
  beforeEach(async () => {
    await raw.flushDb()
    proxy = await redisTransportStall(broker.getHost(), broker.getMappedPort(6379))
    client = open(`redis://127.0.0.1:${proxy.port}`)
    client.on('error', () => undefined)
    await client.connect()
    store = new AbuseCounterStore(new BoundedRedis(client as unknown as AppRedisClient))
  })
  afterEach(async () => {
    proxy.release()
    if (client.isOpen) client.destroy()
    await proxy.close()
  })
  afterAll(async () => {
    if (raw?.isOpen) await raw.quit()
    await broker?.stop()
  }, 60000)

  const settle = async <T>(attempt: () => Promise<T>, limitMs = 10000): Promise<number> => {
    const started = performance.now()
    for (;;) {
      try {
        await attempt()
        return performance.now() - started
      } catch (error) {
        if (performance.now() - started > limitMs) throw error
        await sleep(25)
      }
    }
  }

  it('b1: times out at the deadline as unknown, the server still runs the command once, nothing is retried', async () => {
    await store.increment(IP, SUBJECT, TTL)
    proxy.holdReplies()

    const started = performance.now()
    const error = await store.increment(IP, SUBJECT, TTL).catch((e: unknown) => e)
    const detection = performance.now() - started

    expect(error).toMatchObject({ kind: 'unavailable', outcome: 'unknown' })
    expect(detection).toBeGreaterThanOrEqual(BOUNDED_REDIS_DEADLINE_MS - 25)
    expect(detection).toBeLessThan(BOUNDED_REDIS_DEADLINE_MS + SLACK_MS)
    console.info(`failure-detection time: ${Math.round(detection)} ms`)
    await proxy.held
    // The caller saw a failure, yet the increment was applied: the outcome really is unknown.
    expect(await raw.get(IP)).toBe('2')

    proxy.release()
    await settle(() => store.read(IP, SUBJECT))
    // Resuming the replies did not replay anything.
    await expect(store.read(IP, SUBJECT)).resolves.toEqual({ ip: 2, subject: 2 })
  })

  it('b1: at capacity new calls fail immediately as not_sent, and slots free when replies resume', async () => {
    proxy.holdReplies()
    const stalled = Array.from({ length: BOUNDED_REDIS_STALLED_CAPACITY }, (_, i) =>
      store.read(`rate:v2:cap:${i}:a`, `rate:v2:cap:${i}:b`).catch((e: unknown) => e)
    )
    for (const error of await Promise.all(stalled))
      expect(error).toMatchObject({ kind: 'unavailable', outcome: 'unknown' })

    const started = performance.now()
    const full = await store.read(IP, SUBJECT).catch((e: unknown) => e)
    expect(performance.now() - started).toBeLessThan(100)
    expect(full).toMatchObject({ kind: 'unavailable', outcome: 'not_sent' })

    proxy.release()
    await settle(() => store.read(IP, SUBJECT))
  })

  it('b2: closing the connection with work pending frees the slots and a fresh call works after reconnect', async () => {
    proxy.holdReplies()
    const stalled = Array.from({ length: BOUNDED_REDIS_STALLED_CAPACITY }, (_, i) =>
      store.increment(`rate:v2:close:${i}:a`, `rate:v2:close:${i}:b`, TTL).catch((e: unknown) => e)
    )
    for (const error of await Promise.all(stalled))
      expect(error).toMatchObject({ outcome: 'unknown' })
    await proxy.held
    expect(await store.read(IP, SUBJECT).catch((e: unknown) => e)).toMatchObject({
      outcome: 'not_sent',
    })

    // Close while every operation is still pending; replies are NOT released first.
    const closedAt = performance.now()
    proxy.dropConnections()
    proxy.release()
    const closureToFresh = await settle(() => store.read(IP, SUBJECT))
    console.info(
      `closure-to-fresh-success time: ${Math.round(performance.now() - closedAt)} ms (${Math.round(closureToFresh)} ms polling)`
    )

    // Every stalled increment ran exactly once on the server, none was replayed.
    for (let i = 0; i < BOUNDED_REDIS_STALLED_CAPACITY; i++)
      expect(await raw.get(`rate:v2:close:${i}:a`)).toBe('1')
  })

  it('a client that is not ready rejects before dispatch, and nothing runs after it reconnects', async () => {
    await store.read(IP, SUBJECT)
    client.destroy()

    const error = await store.increment(IP, SUBJECT, TTL).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'unavailable', outcome: 'not_sent' })

    await client.connect()
    await expect(store.read(IP, SUBJECT)).resolves.toEqual({ ip: 0, subject: 0 })
    expect(await raw.get(IP)).toBeNull()
  })
})
