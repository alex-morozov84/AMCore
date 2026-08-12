import type { UserResponse } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { redisVaultLock } from './session-lock'
import type { UpstreamRefreshFn } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

// Real Redis lock + real Redis vault — proving the *actual* SET NX PX /
// CAS-with-cjson Lua scripts correctly serialize two concurrent callers,
// not just `ensure-fresh-session.single-flight.test.ts`'s JS-side
// `QueuedFakeLock` simulation. This is the multi-replica-web scenario in
// miniature: two independent `ensureFreshSession` calls (standing in for
// two different Next server processes/replicas handling the same session
// at the same moment) racing against the same expired vault entry.
vi.mock('server-only', () => ({}))

let container: StartedRedisContainer | undefined

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = container.getConnectionUrl()
}, 60_000)

afterAll(async () => {
  await container?.stop()
})

describe('ensureFreshSession single-flight refresh against real Redis', () => {
  it('two concurrent callers on the same expired session both get the one rotated result', async () => {
    const sessionId = `it-concurrent-${crypto.randomUUID()}`
    await redisVaultStore.create(sessionId, {
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      accessTokenExpiresAt: Date.now() - 1000,
      userSnapshot: { id: 'u1' } as unknown as UserResponse,
    })

    let refreshCalls = 0
    const upstreamRefresh: UpstreamRefreshFn = vi.fn(async () => {
      refreshCalls++
      // Simulate real network latency so both callers are genuinely
      // in flight together, not accidentally serialized by Node's own
      // single-threaded scheduling before either reaches Redis.
      await new Promise((resolve) => setTimeout(resolve, 50))
      return {
        accessToken: 'at-new',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-new',
      }
    })

    const deps = { store: redisVaultStore, lock: redisVaultLock, upstreamRefresh }
    const [first, second] = await Promise.all([
      ensureFreshSession(sessionId, deps),
      ensureFreshSession(sessionId, deps),
    ])

    expect(refreshCalls).toBe(1)
    expect(first.accessToken).toBe('at-new')
    expect(second.accessToken).toBe('at-new')
    expect(first.refreshToken).toBe('rt-new')
    expect(second.refreshToken).toBe('rt-new')

    const stored = await redisVaultStore.get(sessionId)
    expect(stored).toMatchObject({ accessToken: 'at-new', version: 2 })
  })
})
