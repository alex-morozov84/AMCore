import { setTimeout as sleep } from 'node:timers/promises'

import { jest } from '@jest/globals'
import { AbortError, createClient, TimeoutError } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import type { PinoLogger } from 'nestjs-pino'

import { EMAIL_TEST_POLICY } from '../src/core/admin/integrations/email-test/email-test.policy.js'
import { EmailTestStore } from '../src/core/admin/integrations/email-test/email-test.store.js'
import { TelegramReachabilityStore } from '../src/core/notifications/channels/telegram/telegram-reachability.store.js'
import type { MetricsService } from '../src/infrastructure/observability/index.js'
import type { AppRedisClient } from '../src/infrastructure/redis/index.js'

import { e2eContainerLabels } from './e2e-owned-containers'
import { redisTransportStall } from './fixtures/redis-transport-stall'
import { appClientOptions } from './test-redis'

// Scaled queue timeout for the cases below. The production value (5000 ms) is asserted in the unit
// spec; the behaviour is the same at any value, and 800 ms keeps each case short.
const QUEUE_MS = 800

// Reconnect delay that outlasts every case in the option group. It stays short on purpose: a
// client destroyed during a very long backoff leaves its reconnect timer alive and Jest cannot exit.
const BACKOFF_MS = 2000

type Proxy = Awaited<ReturnType<typeof redisTransportStall>>

/**
 * Pins what the application relies on from node-redis 6 against a real server: the negotiated
 * protocol, option propagation, what the queue timeout does and does not bound, and recovery.
 * Each case that proves a bound has a positive control that shows the same path succeeding.
 */
describe('node-redis 6 client contract against Redis 7', () => {
  let broker: StartedRedisContainer
  let raw: ReturnType<typeof createClient>
  let proxy: Proxy
  const open: Array<{ isOpen: boolean; destroy: () => void }> = []

  const connect = async (
    reconnectMs: number | false,
    timeoutMs = QUEUE_MS
  ): Promise<AppRedisClient> => {
    const options = appClientOptions(`redis://127.0.0.1:${proxy.port}`, {
      reconnectStrategy: reconnectMs === false ? false : () => reconnectMs,
    })
    const client = createClient({
      ...options,
      commandOptions: { timeout: timeoutMs },
    }) as unknown as AppRedisClient
    client.on('error', () => undefined)
    open.push(client)
    await client.connect()
    return client
  }

  /** Puts the client into reconnect backoff: the first attempt after the drop is refused. */
  const intoBackoff = async (): Promise<void> => {
    proxy.refuseConnections(true)
    proxy.dropConnections()
    await sleep(150)
  }

  const settleAfter = async (work: Promise<unknown>): Promise<{ at: number; error?: unknown }> => {
    const started = performance.now()
    const error = await work.then(
      () => undefined,
      (e: unknown) => e
    )
    return { at: performance.now() - started, error }
  }

  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    raw = createClient({ url: broker.getConnectionUrl(), RESP: 2 })
    raw.on('error', () => undefined)
    await raw.connect()
  }, 120000)
  beforeEach(async () => {
    await raw.flushDb()
    proxy = await redisTransportStall(broker.getHost(), broker.getMappedPort(6379))
  })
  afterEach(async () => {
    proxy.release()
    for (const client of open.splice(0)) if (client.isOpen) client.destroy()
    await proxy.close()
  })
  afterAll(async () => {
    if (raw?.isOpen) await raw.quit()
    await broker?.stop()
  }, 60000)

  describe('protocol and handshake', () => {
    const commandStats = async (): Promise<string> => String(await raw.info('commandstats'))

    it('the application options negotiate RESP 2 and never send HELLO', async () => {
      await raw.configResetStat()
      const client = await connect(false)
      await client.ping()
      const info = String(await client.sendCommand(['CLIENT', 'INFO']))

      expect(info).toMatch(/\bresp=2\b/)
      expect(await commandStats()).not.toContain('cmdstat_hello')
      expect(String(await raw.info('errorstats'))).not.toMatch(/errorstat_/)
    })

    it('positive control: the library default sends HELLO 3 and the server reports RESP 3', async () => {
      await raw.configResetStat()
      const defaults = createClient({ url: `redis://127.0.0.1:${proxy.port}` })
      defaults.on('error', () => undefined)
      open.push(defaults)
      await defaults.connect()
      const info = String(await defaults.sendCommand(['CLIENT', 'INFO']))

      expect(info).toMatch(/\bresp=3\b/)
      expect(await commandStats()).toContain('cmdstat_hello')
    })

    it('a duplicate keeps RESP 2 and the queue timeout', async () => {
      const client = await connect(false)
      const copy = client.duplicate()
      copy.on('error', () => undefined)
      open.push(copy)
      await copy.connect()

      expect(copy.options?.RESP).toBe(2)
      expect(copy.options?.commandOptions?.timeout).toBe(QUEUE_MS)
      expect(String(await copy.sendCommand(['CLIENT', 'INFO']))).toMatch(/\bresp=2\b/)
    })
  })

  describe('reply shapes the application reads', () => {
    it('keeps the values and null/number/array types of the commands in use', async () => {
      const client = await connect(false)

      expect(
        await client.set('c:nx', 'v', { condition: 'NX', expiration: { type: 'PX', value: 5000 } })
      ).toBe('OK')
      expect(
        await client.set('c:nx', 'w', { condition: 'NX', expiration: { type: 'PX', value: 5000 } })
      ).toBeNull()
      expect(await client.getDel('c:nx')).toBe('v')
      expect(await client.getDel('c:nx')).toBeNull()
      await client.sAdd('c:set', ['a', 'b'])
      expect((await client.sMembers('c:set')).sort()).toEqual(['a', 'b'])
      await client.hSet('c:hash', { f: '1' })
      expect(await client.hGetAll('c:hash')).toEqual({ f: '1' })
      expect(await client.eval('return {1, "x", false}', { keys: [], arguments: [] })).toEqual([
        1,
        'x',
        null,
      ])
      expect(
        await client.eval('return redis.call("INCR", KEYS[1])', { keys: ['c:n'], arguments: [] })
      ).toBe(1)
      const time = await client.sendCommand<string[]>(['TIME'])
      expect(time).toHaveLength(2)
      expect(Number(time[0])).toBeGreaterThan(1_600_000_000)
    })
  })

  describe('option propagation while a command waits in the queue', () => {
    it('a local timeout overrides the base value for typed and raw commands', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff()

      const typed = await settleAfter(client.withCommandOptions({ timeout: 200 }).get('k'))
      const rawTime = await settleAfter(
        client.withCommandOptions({ timeout: 200 }).sendCommand(['TIME'])
      )

      for (const outcome of [typed, rawTime]) {
        expect(outcome.error).toBeInstanceOf(TimeoutError)
        expect(outcome.at).toBeLessThan(QUEUE_MS - 200)
      }
    })

    it('a local abort signal cancels a raw command, and a chained proxy inherits it', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff()

      const direct = await settleAfter(
        client.withCommandOptions({ abortSignal: AbortSignal.timeout(150) }).sendCommand(['TIME'])
      )
      const chained = await settleAfter(
        client
          .withCommandOptions({ abortSignal: AbortSignal.timeout(150) })
          .withCommandOptions({ timeout: 10_000 })
          .get('k')
      )

      expect(direct.error).toBeInstanceOf(AbortError)
      expect(chained.error).toBeInstanceOf(AbortError)
      expect(Math.max(direct.at, chained.at)).toBeLessThan(QUEUE_MS - 200)
    })

    it('a command without local options expires at the base queue timeout', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff()

      const outcome = await settleAfter(client.get('k'))

      expect(outcome.error).toBeInstanceOf(TimeoutError)
      expect(outcome.at).toBeGreaterThanOrEqual(QUEUE_MS - 100)
      expect(outcome.at).toBeLessThan(QUEUE_MS + 600)
    })
  })

  describe('queue timeout against reconnect', () => {
    it('positive control: a queued command runs exactly once when the connection returns in time', async () => {
      const client = await connect(300)
      await intoBackoff()
      const pending = client.incr('q:once')
      proxy.refuseConnections(false)

      await expect(pending).resolves.toBe(1)
      await sleep(500)
      expect(await raw.get('q:once')).toBe('1')
    })

    it('an expired queued command never mutates after the connection returns', async () => {
      const client = await connect(QUEUE_MS + 1200)
      await intoBackoff()

      const outcome = await settleAfter(client.incr('q:late'))
      expect(outcome.error).toBeInstanceOf(TimeoutError)

      proxy.refuseConnections(false)
      await sleep(QUEUE_MS + 1800) // the reconnect happens and a fresh command succeeds
      await expect(client.ping()).resolves.toBe('PONG')
      expect(await raw.get('q:late')).toBeNull()
    }, 20000)

    it('a written command with a held reply stays pending: the queue timeout does not bound it', async () => {
      const client = await connect(false)
      proxy.holdReplies()
      let settled = false
      const pending = client.incr('q:held').finally(() => {
        settled = true
      })
      pending.catch(() => undefined)
      await proxy.held
      await sleep(QUEUE_MS + 500)

      expect(settled).toBe(false)
      expect(await raw.get('q:held')).toBe('1') // the server ran it once; the caller still waits
    })
  })

  describe('MULTI and pipeline are not covered by the queue timeout', () => {
    it('a MULTI queued during backoff waits past the timeout and runs when the connection returns', async () => {
      const client = await connect(QUEUE_MS + 800)
      await intoBackoff()

      let settled = false
      const pending = client
        .multi()
        .incr('m:one')
        .exec()
        .finally(() => {
          settled = true
        })
      await sleep(QUEUE_MS + 300)
      expect(settled).toBe(false) // a typed command would have expired by now

      proxy.refuseConnections(false)
      await expect(pending).resolves.toEqual([1])
    }, 20000)
  })

  describe('subscriber recovery', () => {
    it('a duplicated subscriber re-subscribes by itself after its connection drops', async () => {
      const client = await connect(100)
      const subscriber = client.duplicate()
      subscriber.on('error', () => undefined)
      open.push(subscriber)
      await subscriber.connect()
      const received: string[] = []
      await subscriber.subscribe('contract:chan', (message) => {
        received.push(message)
      })
      await raw.publish('contract:chan', 'before')
      const delivered = Date.now() + 3000
      while (!received.includes('before') && Date.now() < delivered) await sleep(20)

      proxy.dropConnections()
      const deadline = Date.now() + 8000
      while (!received.includes('after') && Date.now() < deadline) {
        await raw.publish('contract:chan', 'after')
        await sleep(100)
      }

      expect(received).toContain('before')
      expect(received).toContain('after')
    }, 20000)
  })

  describe('raw TIME consumers keep their own bound and mapping', () => {
    const metrics = { incRedisClientEvent: jest.fn() } as unknown as MetricsService
    const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger

    it('email test: a held reply ends as the unavailable error within its own deadline', async () => {
      const client = await connect(false)
      const store = new EmailTestStore(client)
      await expect(store.now()).resolves.toBeGreaterThan(1_600_000_000_000) // positive control
      proxy.holdReplies()

      const outcome = await settleAfter(store.now())

      expect(outcome.error).toMatchObject({ status: 503 })
      expect(outcome.at).toBeLessThan(EMAIL_TEST_POLICY.redisCommandMs + 600)
    })

    it('telegram: a held reply ends as undefined within its own deadline', async () => {
      const client = await connect(false)
      const store = new TelegramReachabilityStore(client, metrics, logger)
      store.open()
      try {
        await sleep(300)
        await expect(store.now()).resolves.toBeGreaterThan(1_600_000_000_000) // positive control
        proxy.holdReplies()

        const started = performance.now()
        await expect(store.now()).resolves.toBeUndefined()

        expect(performance.now() - started).toBeLessThan(2_000 + 600)
      } finally {
        proxy.release()
        await store.close()
      }
    }, 20000)
  })
})
