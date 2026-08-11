import type { UserResponse } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { redisVaultLock } from './session-lock'
import type { VaultEntry } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

// Real Redis, not the mocked client the default unit suite uses — the unit
// suite's mocked `eval()` never actually runs the Lua scripts below, so it
// cannot catch a CAS/lock script that is syntactically wrong or behaves
// differently against real Redis than the JS-side fakes assume.
vi.mock('server-only', () => ({}))

let container: StartedRedisContainer | undefined

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = container.getConnectionUrl()
}, 60_000)

afterAll(async () => {
  // `container` stays undefined if `beforeAll` itself failed (e.g. no
  // container runtime available) — stopping it unconditionally masked that
  // real failure behind a second, confusing "Cannot read properties of
  // undefined" error.
  await container?.stop()
})

function entry(overrides: Partial<VaultEntry> = {}): Omit<VaultEntry, 'version'> {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAt: Date.now() + 60_000,
    userSnapshot: { id: 'u1' } as unknown as UserResponse,
    ...overrides,
  }
}

describe('redisVaultStore against real Redis', () => {
  it('create() then get() round-trips the entry at version 1', async () => {
    const id = `it-${crypto.randomUUID()}`
    await redisVaultStore.create(id, entry())

    await expect(redisVaultStore.get(id)).resolves.toMatchObject({
      accessToken: 'at-1',
      version: 1,
    })
  })

  it('get() returns null for a key that was never created', async () => {
    await expect(redisVaultStore.get(`it-missing-${crypto.randomUUID()}`)).resolves.toBeNull()
  })

  it('setIfVersionMatches() runs the real CAS Lua script: succeeds on a matching version', async () => {
    const id = `it-${crypto.randomUUID()}`
    await redisVaultStore.create(id, entry())

    const written = await redisVaultStore.setIfVersionMatches(id, 1, entry({ accessToken: 'at-2' }))

    expect(written).toBe(true)
    await expect(redisVaultStore.get(id)).resolves.toMatchObject({
      accessToken: 'at-2',
      version: 2,
    })
  })

  it('setIfVersionMatches() rejects a stale version instead of overwriting', async () => {
    const id = `it-${crypto.randomUUID()}`
    await redisVaultStore.create(id, entry())
    await redisVaultStore.setIfVersionMatches(id, 1, entry({ accessToken: 'winner' }))

    // Stale caller still thinks the version is 1.
    const written = await redisVaultStore.setIfVersionMatches(
      id,
      1,
      entry({ accessToken: 'loser' })
    )

    expect(written).toBe(false)
    await expect(redisVaultStore.get(id)).resolves.toMatchObject({ accessToken: 'winner' })
  })

  it('delete() removes the entry', async () => {
    const id = `it-${crypto.randomUUID()}`
    await redisVaultStore.create(id, entry())
    await redisVaultStore.delete(id)

    await expect(redisVaultStore.get(id)).resolves.toBeNull()
  })
})

describe('redisVaultLock against real Redis', () => {
  it('acquire() then release() via the real token-checked DEL script', async () => {
    const id = `it-lock-${crypto.randomUUID()}`
    const token = await redisVaultLock.acquire(id, 5_000)
    expect(token).not.toBeNull()

    // Held: a second acquire must fail while the first holds it.
    await expect(redisVaultLock.acquire(id, 5_000)).resolves.toBeNull()

    await redisVaultLock.release(id, token!)

    // Free again after release.
    const reacquired = await redisVaultLock.acquire(id, 5_000)
    expect(reacquired).not.toBeNull()
  })

  it('release() with the wrong token is a no-op (real token-checked script, not a bare DEL)', async () => {
    const id = `it-lock-${crypto.randomUUID()}`
    const token = await redisVaultLock.acquire(id, 5_000)
    expect(token).not.toBeNull()

    await redisVaultLock.release(id, 'not-the-real-token')

    // Still held — a wrong-token release must not have deleted it.
    await expect(redisVaultLock.acquire(id, 5_000)).resolves.toBeNull()
  })

  it('renew() via the real token-checked PEXPIRE script extends the lease, and rejects the wrong token', async () => {
    const id = `it-lock-${crypto.randomUUID()}`
    const token = await redisVaultLock.acquire(id, 1_000)

    await expect(redisVaultLock.renew(id, token!, 5_000)).resolves.toBe(true)
    await expect(redisVaultLock.renew(id, 'wrong-token', 5_000)).resolves.toBe(false)
  })
})
