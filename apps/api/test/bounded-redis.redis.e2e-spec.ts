import { setTimeout as sleep } from 'node:timers/promises'

import { jest } from '@jest/globals'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { ServiceUnavailableException } from '../src/common/exceptions'
import { ApiKeyAbuseLimiterService } from '../src/core/api-keys/api-key-abuse-limiter.service'
import { InviteAcceptLimiterService } from '../src/core/organizations/invite-accept-limiter.service'
import { AbuseCounterStore } from '../src/infrastructure/redis/abuse-counter.store'
import {
  BOUNDED_REDIS_CAPACITY,
  BOUNDED_REDIS_DEADLINE_MS,
  BoundedRedis,
} from '../src/infrastructure/redis/bounded-redis'
import type { AppRedisClient } from '../src/infrastructure/redis/redis-connection.service'

import { e2eContainerLabels } from './e2e-owned-containers'
import { redisTransportStall } from './fixtures/redis-transport-stall'
import { appClientOptions, type RedisConnection } from './test-redis'

const IP = 'rate:v2:stall_ip:203.0.113.2'
const SUBJECT = 'rate:v2:stall_subject:fp'
const TTL = 3_600_000
const SLACK_MS = 750

type Client = RedisConnection
const open = (url: string): Client =>
  createClient(
    appClientOptions(url, { reconnectStrategy: (retries) => Math.min(retries * 50, 250) })
  )

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
    const stalled = Array.from({ length: BOUNDED_REDIS_CAPACITY }, (_, i) =>
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
    const stalled = Array.from({ length: BOUNDED_REDIS_CAPACITY }, (_, i) =>
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
    for (let i = 0; i < BOUNDED_REDIS_CAPACITY; i++)
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

  it('aborts a command still waiting in the client queue; no late mutation after reconnect', async () => {
    // A slow reconnect keeps the command in node-redis's offline queue. Readiness is forced
    // to true so the helper dispatches into that queue: the one path where a command is
    // accepted before the connection can write it.
    const slow = createClient(
      appClientOptions(`redis://127.0.0.1:${proxy.port}`, {
        // Constant: version 6 keeps retrying on this schedule. A shorter later delay would let an
        // attempt connect to the refusing proxy and write the command before it is reset.
        reconnectStrategy: () => 1500,
      })
    )
    slow.on('error', () => undefined)
    await slow.connect()
    try {
      const helper = new BoundedRedis(slow as unknown as AppRedisClient)
      // Reconnect attempts fail while the proxy refuses connections, so the client waits its
      // strategy delay (the first attempt after a drop is always immediate).
      proxy.refuseConnections(true)
      proxy.dropConnections()
      for (const started = performance.now(); slow.isReady;) {
        if (performance.now() - started > 3000) throw new Error('client never lost readiness')
        await sleep(10)
      }
      Object.defineProperty(slow, 'isReady', { get: () => true, configurable: true })

      const aborted = helper
        .run((client) => client.set('rate:v2:queued:aborted', '1'), BOUNDED_REDIS_DEADLINE_MS)
        .catch((e: unknown) => e)
      const control = helper.run((client) => client.set('rate:v2:queued:control', '1'), 10000)

      // The deadline aborts the queued command; its outcome is still reported as unknown.
      expect(await aborted).toMatchObject({ reason: 'deadline', outcome: 'unknown' })
      proxy.refuseConnections(false)
      delete (slow as unknown as { isReady?: boolean }).isReady
      await expect(control).resolves.toBe('OK')

      // Positive control: a queued command that was not aborted does run after reconnect.
      expect(await raw.get('rate:v2:queued:control')).toBe('1')
      expect(await raw.get('rate:v2:queued:aborted')).toBeNull()
    } finally {
      delete (slow as unknown as { isReady?: boolean }).isReady
      if (slow.isOpen) slow.destroy()
    }
  })

  describe('caller mapping with an executed command whose reply is held', () => {
    let logger: { setContext: jest.Mock; warn: jest.Mock }
    let apiKey: ApiKeyAbuseLimiterService
    let invite: InviteAcceptLimiterService
    const ip = '203.0.113.7'

    beforeEach(() => {
      logger = { setContext: jest.fn(), warn: jest.fn() }
      apiKey = new ApiKeyAbuseLimiterService(store, logger as never)
      invite = new InviteAcceptLimiterService(store, logger as never)
    })

    const events = (): unknown[] =>
      logger.warn.mock.calls
        .map(([payload]) => payload as { event?: string; case?: string; keyClass?: string })
        .filter((payload) => payload.event)

    it('answers 503 and classifies the record as unknown while the server applied it once', async () => {
      proxy.holdReplies()

      const first = await apiKey.consume(ip, 'fpa').catch((e: unknown) => e)
      const second = await invite.consume(ip, 'fpb').catch((e: unknown) => e)

      expect(first).toBeInstanceOf(ServiceUnavailableException)
      expect(second).toBeInstanceOf(ServiceUnavailableException)
      expect(events()).toEqual([
        expect.objectContaining({
          event: 'abuse_counter.record_failed',
          case: 'unknown',
          keyClass: 'api_key',
        }),
        expect.objectContaining({
          event: 'abuse_counter.record_failed',
          case: 'unknown',
          keyClass: 'invite_accept',
        }),
      ])
      await proxy.held
      // Both commands reached the server and ran exactly once although both callers failed.
      expect(await raw.get(`rate:v2:api_key_fail_ip:${ip}`)).toBe('1')
      expect(await raw.get(`rate:v2:invite_accept_fail_ip:${ip}`)).toBe('1')
    })

    it('fails the check closed with 503 and an unknown case when its read reply is held', async () => {
      proxy.holdReplies()

      const first = await apiKey.check(ip, 'fpa').catch((e: unknown) => e)
      const second = await invite.check(ip, 'fpb').catch((e: unknown) => e)

      expect(first).toBeInstanceOf(ServiceUnavailableException)
      expect(second).toBeInstanceOf(ServiceUnavailableException)
      expect(events().map((e) => (e as { event: string }).event)).toEqual([
        'abuse_counter.check_failed',
        'abuse_counter.check_failed',
      ])
    })
  })
})
