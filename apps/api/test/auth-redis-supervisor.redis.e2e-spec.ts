import { setTimeout as sleep } from 'node:timers/promises'

import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import type { AuthRedisEvent } from '../src/infrastructure/redis/auth-redis/auth-redis.constants'
import { AUTH_REDIS_DEFAULTS } from '../src/infrastructure/redis/auth-redis/auth-redis.constants'
import { AuthRedisSupervisor } from '../src/infrastructure/redis/auth-redis/auth-redis-supervisor'
import type { AppRedisClient } from '../src/infrastructure/redis/redis-client-options'

import { e2eContainerLabels } from './e2e-owned-containers'
import { redisTransportStall } from './fixtures/redis-transport-stall'
import { appClientOptions } from './test-redis'

// The supervisor runs against a real Redis through the suite-owned TCP fixture. The fault
// model is application-level (streams are held, dropped or refused), not kernel packet loss,
// and the recovery times below are scoped acceptance targets for these fault classes.

const HEAL_BUDGET_MS = 3500 + 1000
const poll = async (
  condition: () => boolean | Promise<boolean>,
  limitMs: number
): Promise<number> => {
  const started = performance.now()
  while (performance.now() - started < limitMs) {
    if (await condition()) return Math.round(performance.now() - started)
    await sleep(50)
  }
  throw new Error(`condition not met within ${limitMs} ms`)
}

describe('AuthRedisSupervisor against a real server', () => {
  let broker: StartedRedisContainer
  let proxy: Awaited<ReturnType<typeof redisTransportStall>>
  let supervisor: AuthRedisSupervisor
  let events: AuthRedisEvent[]
  let created: AppRedisClient[]

  const reasons = (): string[] =>
    events.flatMap((event) => (event.kind === 'replaced' ? [event.reason] : []))
  const healthy = (): Promise<boolean> =>
    supervisor
      .run((client) => client.ping(), 250)
      .then(
        (reply) => reply === 'PONG',
        () => false
      )

  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
  }, 120000)
  afterAll(async () => {
    await broker?.stop()
  }, 60000)

  beforeEach(async () => {
    events = []
    created = []
    proxy = await redisTransportStall(broker.getHost(), broker.getMappedPort(6379))
    supervisor = new AuthRedisSupervisor(
      () => {
        const base = appClientOptions(`redis://127.0.0.1:${proxy.port}`)
        const client = createClient({
          ...base,
          socket: { ...base.socket, connectTimeout: AUTH_REDIS_DEFAULTS.connectTimeoutMs },
        }) as AppRedisClient
        created.push(client)
        return client
      },
      (event) => events.push(event)
    )
    supervisor.start()
    await poll(healthy, 5000)
  })
  afterEach(async () => {
    supervisor.stop()
    proxy.release()
    await proxy.close()
  })

  it('serves a real command and stays on one generation while healthy', async () => {
    await expect(supervisor.run((client) => client.ping())).resolves.toBe('PONG')
    await sleep(5000)
    expect(reasons()).toEqual([])
    expect(created).toHaveLength(1)
  }, 30000)

  it('recovers from a transport reset by itself without replacing the generation', async () => {
    proxy.dropConnections()
    const recovered = await poll(healthy, HEAL_BUDGET_MS)
    expect(recovered).toBeLessThan(HEAL_BUDGET_MS)
    expect(reasons()).toEqual([])
  }, 30000)

  it('replaces a generation whose replies are held and recovers after the stall clears', async () => {
    proxy.holdReplies()
    const held = Array.from({ length: 10 }, () =>
      supervisor.run((client) => client.ping(), 250).catch((error: unknown) => error)
    )
    await Promise.all(held)
    await poll(() => reasons().includes('stall'), 6000)
    expect(created.length).toBeGreaterThanOrEqual(2)
    proxy.release()
    await poll(healthy, HEAL_BUDGET_MS)
    expect(supervisor.stats().unsettled).toBe(0)
    expect(supervisor.stats().live.filter((state) => state === 'active')).toHaveLength(1)
  }, 40000)

  it('lets the client reconnect by itself while connections are refused', async () => {
    // A refused connection is visible connection-level progress (errors, reconnect attempts):
    // the client's own backoff handles it and no replacement is needed.
    proxy.refuseConnections(true)
    proxy.dropConnections()
    await sleep(4000)
    await expect(healthy()).resolves.toBe(false)
    proxy.refuseConnections(false)
    await poll(healthy, HEAL_BUDGET_MS)
    expect(reasons().filter((reason) => reason === 'stall')).toEqual([])
  }, 40000)

  it('replaces a generation whose reconnect handshake hangs, then recovers after the heal', async () => {
    proxy.holdCommands()
    proxy.dropConnections()
    await poll(
      () => reasons().includes('reconnect-hang') || reasons().includes('handshake'),
      AUTH_REDIS_DEFAULTS.notReadyMs + 4000
    )
    const live = supervisor.stats().live.filter((state) => state !== 'closed')
    expect(live.length).toBeLessThanOrEqual(1 + AUTH_REDIS_DEFAULTS.retiringCap)
    proxy.release()
    await poll(healthy, HEAL_BUDGET_MS)
    expect(supervisor.stats().unsettled).toBe(0)
  }, 40000)

  it('stays bounded over repeated stall and heal cycles', async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      proxy.holdReplies()
      void supervisor.run((client) => client.ping(), 250).catch(() => undefined)
      await poll(() => reasons().filter((r) => r === 'stall').length > cycle, 15000)
      proxy.release()
      await poll(healthy, HEAL_BUDGET_MS + 5000)
    }
    const stats = supervisor.stats()
    expect(stats.unsettled).toBe(0)
    expect(stats.generations).toBeLessThanOrEqual(AUTH_REDIS_DEFAULTS.history + 1 + 3)
    expect(created.filter((client) => client.isOpen).length).toBeLessThanOrEqual(
      1 + AUTH_REDIS_DEFAULTS.retiringCap
    )
  }, 120000)

  it('disposes every generation on stop', async () => {
    proxy.holdReplies()
    void supervisor.run((client) => client.ping(), 250).catch(() => undefined)
    await poll(() => reasons().includes('stall'), 6000)
    supervisor.stop()
    expect(created.filter((client) => client.isOpen)).toHaveLength(0)
    await expect(supervisor.run((client) => client.ping())).rejects.toMatchObject({
      reason: 'not_ready',
    })
  }, 30000)
})
