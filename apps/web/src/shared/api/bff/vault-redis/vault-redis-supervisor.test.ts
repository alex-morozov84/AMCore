// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeVaultClient } from './test-vault-redis-fakes'
import { VaultRedisBounded } from './vault-redis-bounded'
import { VaultRedisSupervisor } from './vault-redis-supervisor'
import { VAULT_REDIS_CAPACITY, VaultRedisError, type VaultRedisEvent } from './vault-redis-types'

// Timers and the supervisor clock advance together; nothing waits in real time. Behavior against
// a real server is covered by the integration suite.

describe('VaultRedisBounded', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const bounded = (client: FakeVaultClient) => new VaultRedisBounded(client.asClient())

  it('refuses at once when the client is not ready, as not_sent', async () => {
    const client = new FakeVaultClient()
    const error = await bounded(client)
      .run((c) => c.ping())
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'not_ready', outcome: 'not_sent' })
  })

  it('answers a deadline error and keeps the slot until the operation settles', async () => {
    const client = new FakeVaultClient()
    client.becomeReady()
    client.hold = true
    const run = bounded(client)
    const outcome = run.run((c) => c.ping(), 250).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(300)
    await expect(outcome).resolves.toMatchObject({ reason: 'deadline', outcome: 'unknown' })
    expect(run.unsettledCount).toBe(1)
    client.destroy()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.unsettledCount).toBe(0)
  })

  it('refuses above the capacity as not_sent without touching the client', async () => {
    const client = new FakeVaultClient()
    client.becomeReady()
    client.hold = true
    const run = bounded(client)
    for (let i = 0; i < VAULT_REDIS_CAPACITY; i++)
      void run.run((c) => c.ping(), 5000).catch(() => 0)
    const error = await run.run((c) => c.ping()).catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'capacity', outcome: 'not_sent' })
  })

  it('reports a synchronous throw as dispatch, not_sent, and releases the slot', async () => {
    const client = new FakeVaultClient()
    client.becomeReady()
    const run = bounded(client)
    const error = await run
      .run((() => {
        throw new TypeError('bug')
      }) as never)
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'dispatch', outcome: 'not_sent' })
    expect(run.unsettledCount).toBe(0)
  })
})

describe('VaultRedisSupervisor', () => {
  let clock: number
  let clients: FakeVaultClient[]
  let events: VaultRedisEvent[]
  let supervisor: VaultRedisSupervisor
  let configure: (client: FakeVaultClient, index: number) => void

  const advance = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      clock += 250
      await vi.advanceTimersByTimeAsync(250)
    }
  }
  const reasons = (): string[] =>
    events.flatMap((event) => (event.kind === 'replaced' ? [event.reason] : []))
  const alerts = (): string[] =>
    events.flatMap((event) => (event.kind === 'alert' ? [event.alert] : []))
  const current = (): FakeVaultClient => clients[clients.length - 1]!

  const build = (timing: Record<string, number> = {}): VaultRedisSupervisor =>
    new VaultRedisSupervisor(
      () => {
        const client = new FakeVaultClient()
        configure(client, clients.length)
        clients.push(client)
        return client.asClient()
      },
      (event) => events.push(event),
      timing,
      () => clock
    )

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0
    clients = []
    events = []
    configure = () => undefined
    supervisor = build()
  })
  afterEach(() => {
    supervisor.stop()
    vi.useRealTimers()
  })

  it('serves operations once the first generation is ready and stays on it while healthy', async () => {
    supervisor.start()
    await advance(60000)
    expect(supervisor.ready).toBe(true)
    await expect(supervisor.run((c) => c.ping())).resolves.toBe('PONG')
    expect(reasons()).toEqual([])
    expect(clients).toHaveLength(1)
  })

  it('replaces a stalled generation, settles its pending operations and serves again', async () => {
    supervisor.start()
    await advance(250)
    const first = current()
    first.hold = true
    const held = Array.from({ length: 10 }, () =>
      supervisor.run((c) => c.ping(), 250).catch((e: unknown) => e)
    )
    await advance(3000)
    expect(reasons()).toEqual(['stall'])
    expect(first.destroyed).toBe(true)
    expect(first.pendingCount).toBe(0)
    await Promise.all(held)
    await advance(250)
    expect(supervisor.stats().unsettled).toBe(0)
    await expect(supervisor.run((c) => c.ping())).resolves.toBe('PONG')
  })

  it('replaces a generation whose first handshake never completes, at a fixed cadence', async () => {
    configure = (client, index) => {
      client.autoReady = index >= 3
    }
    supervisor.start()
    await advance(10000)
    expect(reasons().slice(0, 3)).toEqual(['handshake', 'handshake', 'handshake'])
    expect(supervisor.ready).toBe(true)
  })

  it('replaces an established generation that lost readiness and never reconnects', async () => {
    supervisor.start()
    await advance(250)
    current().loseReadiness()
    expect(supervisor.ready).toBe(false)
    await advance(3500)
    expect(reasons()).toContain('reconnect-hang')
  })

  it('replaces a client that closed itself', async () => {
    supervisor.start()
    await advance(250)
    current().endByItself()
    await advance(3250)
    expect(reasons()).toEqual(['unplanned-end'])
  })

  it('replaces a generation whose PING does not answer PONG and raises an alert', async () => {
    supervisor.start()
    await advance(250)
    current().pingReply = 'OK'
    await advance(4500)
    expect(reasons()).toContain('protocol-mismatch')
    expect(alerts()).toContain('protocol-mismatch')
  })

  it('keeps a destroy that had no logical effect counted as leaked and alerts', async () => {
    configure = (client, index) => {
      client.destroyWorks = index !== 0
    }
    supervisor.start()
    await advance(250)
    current().hold = true
    void supervisor.run((c) => c.ping(), 250).catch(() => undefined)
    await advance(9000)
    expect(alerts()).toContain('retire-timeout')
    expect(supervisor.stats().live).toContain('leaked')
  })

  it('keeps bounded history over many replacement cycles', async () => {
    configure = (client) => {
      client.autoReady = false
    }
    supervisor.start()
    await advance(120000)
    expect(clients.length).toBeGreaterThan(20)
    expect(supervisor.stats().generations).toBeLessThanOrEqual(8 + 4)
  })

  it('disposes every generation on stop and refuses new operations', async () => {
    supervisor.start()
    await advance(250)
    expect(supervisor.stop()).toEqual({ logicallyOpen: 0 })
    const error = await supervisor.run((c) => c.ping()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VaultRedisError)
    expect(error).toMatchObject({ reason: 'not_ready', outcome: 'not_sent' })
  })

  it('reports a generation that stayed logically open at stop', async () => {
    configure = (client) => {
      client.destroyWorks = false
    }
    supervisor.start()
    await advance(250)
    expect(supervisor.stop()).toEqual({ logicallyOpen: 1 })
  })
})
