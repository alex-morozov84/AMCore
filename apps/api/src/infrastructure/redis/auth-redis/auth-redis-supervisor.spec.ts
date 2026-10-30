import { BoundedRedisError } from '../bounded-redis.js'

import type { AuthRedisEvent } from './auth-redis.constants.js'
import { AuthRedisSupervisor } from './auth-redis-supervisor.js'
import { FakeRedisClient } from './fake-redis-client.testkit.js'

// Timers and the supervisor clock are driven together; nothing waits in real time. Behavior
// against a real server (reset, stall, heal) is covered by the Redis integration suite.

describe('AuthRedisSupervisor', () => {
  let clock: number
  let clients: FakeRedisClient[]
  let events: AuthRedisEvent[]
  let supervisor: AuthRedisSupervisor
  let configure: (client: FakeRedisClient, index: number) => void

  const advance = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      clock += 250
      await jest.advanceTimersByTimeAsync(250)
    }
  }
  const reasons = (): string[] =>
    events.flatMap((event) => (event.kind === 'replaced' ? [event.reason] : []))
  const alerts = (): string[] =>
    events.flatMap((event) => (event.kind === 'alert' ? [event.alert] : []))
  const current = (): FakeRedisClient => clients[clients.length - 1]!

  const build = (timing: Record<string, number> = {}): AuthRedisSupervisor =>
    new AuthRedisSupervisor(
      () => {
        const client = new FakeRedisClient()
        configure(client, clients.length)
        clients.push(client)
        return client.asClient()
      },
      (event) => events.push(event),
      timing,
      () => clock
    )

  beforeEach(() => {
    jest.useFakeTimers()
    clock = 0
    clients = []
    events = []
    configure = () => undefined
    supervisor = build()
  })
  afterEach(() => {
    supervisor.stop()
    jest.useRealTimers()
  })

  it('serves operations once the first generation is ready', async () => {
    supervisor.start()
    await advance(250)
    expect(supervisor.ready).toBe(true)
    await expect(supervisor.run((client) => client.ping())).resolves.toBe('PONG')
    expect(reasons()).toEqual([])
  })

  it('refuses operations as not_sent before the first generation is ready', async () => {
    configure = (client) => {
      client.autoReady = false
    }
    supervisor.start()
    const error = await supervisor.run((client) => client.ping()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BoundedRedisError)
    expect(error).toMatchObject({ reason: 'not_ready', outcome: 'not_sent' })
  })

  describe('stall', () => {
    it('replaces a generation whose oldest operation is older than the stall limit', async () => {
      supervisor.start()
      await advance(250)
      const first = current()
      first.hold = true
      const held = Array.from({ length: 10 }, () =>
        supervisor.run((client) => client.ping(), 250).catch((e: unknown) => e)
      )
      await advance(2750)
      expect(reasons()).toEqual(['stall'])
      expect(first.destroyed).toBe(true)
      expect(first.pendingCount).toBe(0)
      expect(clients).toHaveLength(2)
      await Promise.all(held)
      await advance(250)
      expect(supervisor.ready).toBe(true)
      expect(supervisor.stats().unsettled).toBe(0)
      await expect(supervisor.run((client) => client.ping())).resolves.toBe('PONG')
    })

    it('applies and resets the flap cooldown only after continuous health', async () => {
      supervisor.start()
      await advance(250)
      for (let cycle = 0; cycle < 3; cycle++) {
        current().hold = true
        void supervisor.run((client) => client.ping(), 250).catch(() => undefined)
        await advance(3000 + 2 ** cycle * 1000)
        await advance(250)
      }
      expect(reasons().filter((reason) => reason === 'stall').length).toBeGreaterThanOrEqual(3)
      expect(supervisor.stats().backoff).toBeGreaterThan(0)
      await advance(31000)
      expect(supervisor.stats().backoff).toBe(0)
    })
  })

  describe('connection lifecycle', () => {
    it('replaces a generation whose first handshake never completes, at a fixed cadence', async () => {
      configure = (client, index) => {
        client.autoReady = index >= 3
      }
      supervisor.start()
      await advance(10000)
      expect(reasons().slice(0, 3)).toEqual(['handshake', 'handshake', 'handshake'])
      expect(supervisor.ready).toBe(true)
      expect(supervisor.stats().live).toEqual(['active'])
    })

    it('replaces an established generation that lost readiness and never reconnects', async () => {
      supervisor.start()
      await advance(250)
      current().loseReadiness()
      expect(supervisor.ready).toBe(false)
      await advance(3500)
      expect(reasons()).toContain('reconnect-hang')
      await advance(250)
      expect(supervisor.ready).toBe(true)
    })

    it('notices lost readiness even without a reconnecting event', async () => {
      supervisor.start()
      await advance(250)
      current().loseReadiness(false)
      await advance(4000)
      expect(reasons()).toContain('reconnect-hang')
    })

    it('replaces a client that closed itself', async () => {
      supervisor.start()
      await advance(250)
      current().endByItself()
      await advance(3250)
      expect(reasons()).toEqual(['unplanned-end'])
      expect(supervisor.ready).toBe(true)
    })

    it('replaces an active generation with no successful operation', async () => {
      supervisor = build({ pingMs: 1_000_000 })
      supervisor.start()
      await advance(4000)
      expect(reasons()).toEqual(['no-success'])
    })
  })

  describe('heartbeat', () => {
    it('replaces a generation whose PING does not answer PONG and raises an alert', async () => {
      supervisor.start()
      await advance(250)
      current().pingReply = 'OK'
      await advance(4500)
      expect(reasons()).toContain('protocol-mismatch')
      expect(alerts()).toContain('protocol-mismatch')
    })

    it('keeps a healthy generation for a long idle period without any replacement', async () => {
      supervisor.start()
      await advance(60000)
      expect(reasons()).toEqual([])
      expect(alerts()).toEqual([])
      expect(clients).toHaveLength(1)
    })
  })

  describe('disposal accounting', () => {
    it('keeps a generation whose destroy did not take effect as leaked, counted and alerted', async () => {
      configure = (client, index) => {
        client.destroyWorks = index !== 0
      }
      supervisor.start()
      await advance(250)
      current().hold = true
      void supervisor.run((client) => client.ping(), 250).catch(() => undefined)
      await advance(3000)
      expect(supervisor.stats().live).toContain('retiring')
      await advance(6000)
      expect(alerts()).toContain('retire-timeout')
      expect(supervisor.stats().live).toContain('leaked')
    })

    it('refuses further replacement at the retiring cap and says so', async () => {
      configure = (client) => {
        client.destroyWorks = false
      }
      supervisor = build({ retiringCap: 1 })
      supervisor.start()
      await advance(250)
      for (let i = 0; i < 4; i++) {
        current().loseReadiness()
        await advance(3500)
      }
      expect(alerts()).toContain('retiring-cap')
      expect(
        supervisor.stats().live.filter((s) => s === 'retiring' || s === 'leaked')
      ).toHaveLength(1)
    })

    it('keeps bounded history across many replacement cycles', async () => {
      configure = (client) => {
        client.autoReady = false
      }
      supervisor.start()
      await advance(120000)
      expect(clients.length).toBeGreaterThan(20)
      expect(supervisor.stats().generations).toBeLessThanOrEqual(8 + 4)
    })
  })

  describe('stop', () => {
    it('disposes every generation logically and refuses new operations', async () => {
      supervisor.start()
      await advance(250)
      current().hold = true
      const held = supervisor.run((client) => client.ping(), 5000).catch((e: unknown) => e)
      expect(supervisor.stop()).toEqual({ logicallyOpen: 0 })
      await held
      expect(current().destroyed).toBe(true)
      const error = await supervisor.run((client) => client.ping()).catch((e: unknown) => e)
      expect(error).toMatchObject({ reason: 'not_ready', outcome: 'not_sent' })
      await advance(10000)
      expect(clients).toHaveLength(1)
    })
  })
})
