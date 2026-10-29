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
 *
 * Transport state is established from observed client events and bounded waits, never from a fixed
 * sleep. Real elapsed time is used only to observe a timeout or a non-settlement after a deadline.
 */
describe('node-redis 6 client contract against Redis 7', () => {
  let broker: StartedRedisContainer
  let raw: ReturnType<typeof createClient>
  let proxy: Proxy
  const open: Array<{ isOpen: boolean; destroy: () => void }> = []
  const errorCounts = new WeakMap<object, number>()

  const connect = async (
    reconnectMs: number | false,
    timeoutMs = QUEUE_MS
  ): Promise<AppRedisClient> => {
    const options = appClientOptions(`redis://127.0.0.1:${proxy.port}`, {
      reconnectStrategy: reconnectMs === false ? false : () => reconnectMs,
    })
    const client = createClient({ ...options, commandOptions: { timeout: timeoutMs } })
    client.on('error', () => errorCounts.set(client, (errorCounts.get(client) ?? 0) + 1))
    open.push(client)
    await client.connect()
    return client
  }

  /** Bounded wait for a condition. A failed premise becomes a normal, readable test failure. */
  const until = async (
    condition: () => boolean | Promise<boolean>,
    what: string,
    limitMs = 10_000
  ): Promise<void> => {
    const deadline = performance.now() + limitMs
    while (!(await condition())) {
      if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
      await sleep(25)
    }
  }

  /**
   * Puts the client into reconnect backoff and waits until it has seen it: the drop closes the
   * socket (first error) and the first reconnect attempt meets the refusing proxy (second error).
   * After both, the client waits out its reconnect delay, and every command issued now is queued.
   */
  const intoBackoff = async (client: AppRedisClient): Promise<void> => {
    const before = errorCounts.get(client) ?? 0
    proxy.refuseConnections(true)
    proxy.dropConnections()
    await until(
      () => !client.isReady && (errorCounts.get(client) ?? 0) >= before + 2,
      'the client to observe the drop and a failed reconnect'
    )
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
      const nx = { condition: 'NX', expiration: { type: 'PX', value: 5000 } } as const

      expect(await client.set('c:nx', 'v', nx)).toBe('OK')
      expect(await client.set('c:nx', 'w', nx)).toBeNull()
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
    // Each case starts a control with no local option in the same established state. The control
    // expires at the base timeout, so a local option that took effect finishes well before it.
    const MARGIN_MS = 200

    it('a local timeout overrides the base value for typed and raw commands', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff(client)

      const control = settleAfter(client.get('control'))
      const typed = settleAfter(client.withCommandOptions({ timeout: 200 }).get('k'))
      const rawTime = settleAfter(client.withCommandOptions({ timeout: 200 }).sendCommand(['TIME']))
      const [base, ...locals] = await Promise.all([control, typed, rawTime])

      expect(base.error).toBeInstanceOf(TimeoutError)
      for (const outcome of locals) {
        expect(outcome.error).toBeInstanceOf(TimeoutError)
        expect(outcome.at + MARGIN_MS).toBeLessThan(base.at)
      }
    })

    it('a local abort signal cancels a raw command, and a chained proxy inherits it', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff(client)

      const control = settleAfter(client.get('control'))
      const direct = settleAfter(
        client.withCommandOptions({ abortSignal: AbortSignal.timeout(150) }).sendCommand(['TIME'])
      )
      const chained = settleAfter(
        client
          .withCommandOptions({ abortSignal: AbortSignal.timeout(150) })
          .withCommandOptions({ timeout: 10_000 })
          .get('k')
      )
      const [base, ...aborted] = await Promise.all([control, direct, chained])

      expect(base.error).toBeInstanceOf(TimeoutError)
      for (const outcome of aborted) {
        expect(outcome.error).toBeInstanceOf(AbortError)
        expect(outcome.at + MARGIN_MS).toBeLessThan(base.at)
      }
    })

    it('a command without local options expires at the base queue timeout', async () => {
      const client = await connect(BACKOFF_MS)
      await intoBackoff(client)

      const outcome = await settleAfter(client.get('k'))

      expect(outcome.error).toBeInstanceOf(TimeoutError)
      expect(outcome.at).toBeGreaterThanOrEqual(QUEUE_MS - 100)
      expect(outcome.at).toBeLessThan(QUEUE_MS + 1000) // generous scheduler slack
    })
  })

  describe('queue timeout against reconnect', () => {
    it('positive control: a queued command runs exactly once when the connection returns in time', async () => {
      const client = await connect(300)
      await intoBackoff(client)
      const pending = client.incr('q:once')
      proxy.refuseConnections(false)

      await expect(pending).resolves.toBe(1)
      await sleep(500) // observation window for a second, unwanted execution
      expect(await raw.get('q:once')).toBe('1')
    })

    it('an expired queued command never mutates after the connection returns', async () => {
      const client = await connect(QUEUE_MS + 1200)
      await intoBackoff(client)

      const outcome = await settleAfter(client.incr('q:late'))
      expect(outcome.error).toBeInstanceOf(TimeoutError)

      proxy.refuseConnections(false)
      await until(() => client.isReady, 'the client to reconnect')
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
      await sleep(QUEUE_MS + 500) // real time past the queue timeout is the observation

      expect(settled).toBe(false)
      expect(await raw.get('q:held')).toBe('1') // the server ran it once; the caller still waits
    })
  })

  describe('MULTI and pipeline are not covered by the queue timeout', () => {
    it.each([
      ['exec', (client: AppRedisClient) => client.multi().incr('m:one').exec()],
      ['execAsPipeline', (client: AppRedisClient) => client.multi().incr('m:one').execAsPipeline()],
    ] as const)(
      '%s queued during backoff waits past the timeout and runs when the connection returns',
      async (_name, run) => {
        const client = await connect(QUEUE_MS + 800)
        await intoBackoff(client)

        // The observer is attached at once, so a rejection fails the premise with its own error.
        const outcome: { value?: unknown; error?: unknown; settled: boolean } = { settled: false }
        void run(client)
          .then(
            (value) => {
              outcome.value = value
            },
            (error: unknown) => {
              outcome.error = error
            }
          )
          .finally(() => {
            outcome.settled = true
          })
        await sleep(QUEUE_MS + 300) // a typed command would have expired by now
        expect(outcome.error).toBeUndefined()
        expect(outcome.settled).toBe(false)

        proxy.refuseConnections(false)
        await until(() => outcome.settled, 'the batch to run after reconnect')
        expect(outcome.error).toBeUndefined()
        expect(outcome.value).toEqual([1])
      },
      20000
    )
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
      await until(() => received.includes('before'), 'the first message', 3000)

      proxy.dropConnections()
      await until(
        async () => {
          await raw.publish('contract:chan', 'after')
          return received.includes('after')
        },
        'a message after the reconnect',
        8000
      )

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
        // The store opens its own duplicate; it answers once that connection is ready.
        await until(
          async () => typeof (await store.now()) === 'number',
          'the store connection to answer (positive control)'
        )
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
