import type { UserResponse } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from '../ensure-fresh-session'
import { SessionLockTimeoutError, SessionVaultUnavailableError } from '../errors'
import { createRedisVaultLock } from '../session-lock-factory'
import type { VaultEntry } from '../session-vault.types'
import { createRedisVaultStore } from '../session-vault-store-factory'

import { redisTransportStall } from './test-redis-transport-stall'
import { stopVaultRedis, vaultRedisStats } from './vault-redis'

// Real Redis through a TCP fixture. The supervised vault connection is a process singleton, so
// each case restarts it against a fresh proxy. Application-level fault model, loopback; the
// timings are bounds for these fault classes on this machine, not guarantees.
vi.mock('server-only', () => ({}))

const HEAL_BUDGET_MS = 3500 + 1500
let container: StartedRedisContainer
let proxy: Awaited<ReturnType<typeof redisTransportStall>>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
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

const entry = (overrides: Partial<VaultEntry> = {}): Omit<VaultEntry, 'version'> => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  accessTokenExpiresAt: Date.now() + 60_000,
  userSnapshot: { id: 'u1' } as unknown as UserResponse,
  ...overrides,
})

const store = createRedisVaultStore('web:session:v1')
const lock = createRedisVaultLock('web:session:v1')
const reachable = async (): Promise<boolean> =>
  store.get(`probe-${crypto.randomUUID()}`, { deadlineMs: 300 }).then(
    () => true,
    () => false
  )

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
}, 60_000)
afterAll(async () => {
  await container?.stop()
})
beforeEach(async () => {
  proxy = await redisTransportStall(container.getHost(), container.getMappedPort(6379))
  process.env.REDIS_URL = `redis://127.0.0.1:${proxy.port}`
  stopVaultRedis()
})
afterEach(async () => {
  stopVaultRedis()
  proxy.release()
  await proxy.close()
})

describe('supervised vault connection against a real server', () => {
  it('serves the store and the lock through the supervised client', async () => {
    const id = `it-${crypto.randomUUID()}`
    await store.create(id, entry())
    await expect(store.get(id)).resolves.toMatchObject({ version: 1 })
    const token = await lock.acquire(id, 5000)
    expect(token).not.toBeNull()
    await expect(lock.acquire(id, 5000, { deadlineMs: 600 })).resolves.toBeNull()
    await expect(lock.renew(id, token!, 5000)).resolves.toBe(true)
    await lock.release(id, token!)
    await expect(lock.acquire(id, 5000)).resolves.not.toBeNull()
  }, 30_000)

  it('recovers from a transport reset without replacing the client', async () => {
    await store.create('it-reset', entry())
    proxy.dropConnections()
    await poll(reachable, HEAL_BUDGET_MS)
    await expect(store.get('it-reset')).resolves.not.toBeNull()
    expect(vaultRedisStats()?.replacements).toBe(0)
  }, 30_000)

  it('replaces a stalled client, settles ten pending operations and serves again after the heal', async () => {
    await store.create('it-stall', entry())
    proxy.holdReplies()
    const pending = Array.from({ length: 10 }, () =>
      store.get('it-stall', { deadlineMs: 250 }).catch((e: unknown) => e)
    )
    const results = await Promise.all(pending)
    expect(results.every((r) => r instanceof SessionVaultUnavailableError)).toBe(true)
    await poll(() => (vaultRedisStats()?.replacements ?? 0) >= 1, 6000)
    // Held operations of the destroyed generation settle at once: nothing stays counted.
    await poll(() => vaultRedisStats()?.unsettled === 0, 3000)
    proxy.release()
    await poll(reachable, HEAL_BUDGET_MS)
    await expect(store.get('it-stall')).resolves.toMatchObject({ refreshToken: 'rt-1' })
  }, 40_000)

  it('refuses a cold command within its own deadline when the handshake never completes, then recovers', async () => {
    proxy.holdCommands()
    const started = performance.now()
    await expect(store.get('it-cold', { deadlineMs: 500 })).rejects.toBeInstanceOf(
      SessionVaultUnavailableError
    )
    // The first-use wait is part of the same budget: 500 ms asked, not 500 ms waiting plus 500 ms.
    expect(performance.now() - started).toBeLessThan(800)
    proxy.release()
    await poll(reachable, HEAL_BUDGET_MS + 3000)
  }, 40_000)

  it('serves the same call normally when nothing is held (healthy control)', async () => {
    await store.create('it-control', entry())
    const started = performance.now()
    await expect(store.get('it-control', { deadlineMs: 600 })).resolves.toMatchObject({
      refreshToken: 'rt-1',
    })
    expect(performance.now() - started).toBeLessThan(600)
  }, 30_000)

  it('counts the wait for the first connection inside the command budget when readiness comes late', async () => {
    // Only this command's reply is held, and only from the moment it is actually sent: the
    // handshake completes first (readiness), then the application command goes out and stalls.
    await store.create('it-budget', entry())
    stopVaultRedis()
    proxy.holdCommands()
    proxy.holdRepliesWhen((chunk) => chunk.includes('it-budget'))
    const started = performance.now()
    const pending = store.get('it-budget', { deadlineMs: 600 }).catch((e: unknown) => e)
    await sleep(350)
    proxy.releaseCommands() // the handshake completes now, near the end of the budget
    await proxy.matchedCommand // readiness was observed: the application command was dispatched
    const dispatchedAt = performance.now() - started
    const error = await pending
    const total = performance.now() - started
    expect(error).toBeInstanceOf(SessionVaultUnavailableError)
    // Dispatched with what was left of the budget, not with a fresh 600 ms.
    expect(dispatchedAt).toBeGreaterThanOrEqual(300)
    expect(total).toBeLessThan(600 + 300)
    expect(total).toBeGreaterThanOrEqual(550)
    proxy.releaseReplies()
  }, 40_000)

  it('stays bounded over repeated stall and heal cycles', async () => {
    await store.create('it-cycles', entry())
    for (let cycle = 0; cycle < 3; cycle++) {
      proxy.holdReplies()
      void store.get('it-cycles', { deadlineMs: 250 }).catch(() => undefined)
      await poll(() => (vaultRedisStats()?.replacements ?? 0) > cycle, 15_000)
      proxy.release()
      await poll(reachable, HEAL_BUDGET_MS + 5000)
    }
    const stats = vaultRedisStats()!
    expect(stats.unsettled).toBe(0)
    expect(stats.generations).toBeLessThanOrEqual(8 + 1 + 3)
  }, 120_000)
})

describe('audience isolation on the supervised connection', () => {
  it('keeps product, staff and console entries and locks apart', async () => {
    const id = `it-aud-${crypto.randomUUID()}`
    const product = createRedisVaultStore('web:session:v1', 'product')
    const staff = createRedisVaultStore('web:staff-session:v1', 'staff')
    const consoleStore = createRedisVaultStore('web:console-session:v1', 'console')
    await product.create(id, entry({ audience: 'product' }))
    await staff.create(id, entry({ audience: 'staff' }))
    await consoleStore.create(id, entry({ audience: 'console' }))
    await staff.delete(id)
    await expect(staff.get(id)).resolves.toBeNull()
    await expect(product.get(id)).resolves.toMatchObject({ audience: 'product' })
    await expect(consoleStore.get(id)).resolves.toMatchObject({ audience: 'console' })
    // A compare-and-set from the wrong audience never overwrites.
    await expect(
      product.setIfVersionMatches(id, 1, entry({ audience: 'staff' }) as never)
    ).resolves.toBe(false)
    const a = await createRedisVaultLock('web:session:v1').acquire(id, 5000)
    await expect(
      createRedisVaultLock('web:staff-session:v1').acquire(id, 5000, { deadlineMs: 300 })
    ).resolves.not.toBeNull()
    expect(a).not.toBeNull()
  }, 30_000)
})

describe('refresh owner across processes on a real lock', () => {
  it('one backend call for contending "processes"; the second one is refused, then serves the published entry', async () => {
    const id = `it-owner-${crypto.randomUUID()}`
    await store.create(id, entry({ accessTokenExpiresAt: Date.now() - 1000 }))
    let release!: (value: {
      accessToken: string
      accessTokenExpiresAt: number
      refreshToken: string
    }) => void
    const upstreamRefresh = vi.fn(
      () =>
        new Promise<{ accessToken: string; accessTokenExpiresAt: number; refreshToken: string }>(
          (resolve) => {
            release = resolve
          }
        )
    )
    const firstProcessLock = createRedisVaultLock('web:session:v1')
    const secondProcessLock = createRedisVaultLock('web:session:v1')
    const first = ensureFreshSession(id, {
      store,
      lock: firstProcessLock,
      verifyBinding: async () => undefined,
      upstreamRefresh,
      timing: { stageMs: 20_000 },
    })
    await poll(() => upstreamRefresh.mock.calls.length === 1, 3000)
    const second = ensureFreshSession(id, {
      store,
      lock: secondProcessLock,
      verifyBinding: async () => undefined,
      upstreamRefresh: vi.fn(),
      timing: { stageMs: 20_000, owner: { acquireMs: 800 } },
    })
    await expect(second).rejects.toBeInstanceOf(SessionLockTimeoutError)
    release({
      accessToken: 'at-2',
      accessTokenExpiresAt: Date.now() + 60_000,
      refreshToken: 'rt-2',
    })
    await expect(first).resolves.toMatchObject({ refreshToken: 'rt-2', version: 2 })
    expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    const third = vi.fn()
    await expect(
      ensureFreshSession(id, {
        store,
        lock: secondProcessLock,
        verifyBinding: async () => undefined,
        upstreamRefresh: third,
      })
    ).resolves.toMatchObject({ refreshToken: 'rt-2' })
    expect(third).not.toHaveBeenCalled()
  }, 60_000)
})
