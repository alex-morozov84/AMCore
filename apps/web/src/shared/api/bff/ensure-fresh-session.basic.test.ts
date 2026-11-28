// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { testAccessToken } from './access-token.testkit'
import { ensureFreshSession } from './ensure-fresh-session'
import {
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionVaultUnavailableError,
} from './errors'
import type { VaultStore } from './session-vault.types'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes'
import { NeverAcquiresLock, SimpleLock } from './test-lock-fakes'

// `server-only` resolves via a bundler `react-server` export condition that
// only Next's own build sets; under plain Vitest resolution it always throws.
// Mocking it is the standard way to unit-test a server-only module directly.
// Vitest hoists `vi.mock` above the imports above regardless of placement.
vi.mock('server-only', () => ({}))

describe('ensureFreshSession — basics and freshness', () => {
  it('throws SessionNotFoundError when there is no vault entry', async () => {
    const store = new FakeVaultStore()
    await expect(
      ensureFreshSession('missing', {
        store,
        lock: new SimpleLock(),
        verifyBinding: async () => undefined,
        upstreamRefresh: vi.fn(),
      })
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  it('returns the cached entry without refreshing when still fresh', async () => {
    const store = new FakeVaultStore()
    const entry = makeEntry()
    store.seed('s1', entry)
    const upstreamRefresh = vi.fn(freshRefresh)

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh,
    })

    expect(result).toBe(entry)
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })

  it('refreshes and persists a new entry when the access token is stale', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const upstreamRefresh = vi.fn(freshRefresh)

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh,
    })

    const rotated = await upstreamRefresh.mock.results[0]!.value
    expect(result.accessToken).toBe(rotated.accessToken)
    expect(result.version).toBe(2)
    expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    await expect(store.get('s1')).resolves.toMatchObject({
      accessToken: rotated.accessToken,
      version: 2,
    })
  })

  it.each([5, 30])('uses the real boundary for a retained %i-minute token', async (minutes) => {
    const store = new FakeVaultStore()
    const issuedAt = 1_700_000_000_000
    const expiry = issuedAt + minutes * 60_000
    const entry = makeEntry({
      accessToken: testAccessToken('issued', expiry),
      accessTokenExpiresAt: issuedAt + 15 * 60_000,
    })
    store.seed('s1', entry)
    let now = expiry - 30_001
    const upstreamRefresh = vi.fn(async () => ({
      accessToken: testAccessToken('next', expiry + 60_000),
      accessTokenExpiresAt: expiry + 60_000,
      refreshToken: 'rt-next',
    }))
    const deps = {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh,
      now: () => now,
    }
    await expect(ensureFreshSession('s1', deps)).resolves.toBe(entry)
    expect(upstreamRefresh).not.toHaveBeenCalled()
    now += 1
    await expect(ensureFreshSession('s1', deps)).resolves.toMatchObject({ version: 2 })
    expect(upstreamRefresh).toHaveBeenCalledOnce()
  })

  it('may rotate again on the next independent request when the whole lifetime is 30 seconds', async () => {
    const now = 1_700_000_000_000
    const store = new FakeVaultStore()
    const expiresAt = now + 30_000
    store.seed('s1', makeEntry({ accessTokenExpiresAt: expiresAt }))
    const upstreamRefresh = vi.fn(async () => ({
      accessToken: testAccessToken('short-lived', expiresAt),
      accessTokenExpiresAt: expiresAt,
      refreshToken: 'rt-next',
    }))
    const deps = {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh,
      now: () => now,
    }
    await expect(ensureFreshSession('s1', deps)).resolves.toMatchObject({ version: 2 })
    await expect(ensureFreshSession('s1', deps)).resolves.toMatchObject({ version: 3 })
    expect(upstreamRefresh).toHaveBeenCalledTimes(2)
  })

  it('throws SessionLockTimeoutError when the lock cannot be acquired', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new NeverAcquiresLock(),
        verifyBinding: async () => undefined,
        upstreamRefresh: vi.fn(freshRefresh),
      })
    ).rejects.toBeInstanceOf(SessionLockTimeoutError)
  })

  it('fails closed (propagates, never treats as logged out) when the vault store is unavailable', async () => {
    const unavailableStore: VaultStore = {
      get: vi.fn().mockRejectedValue(new SessionVaultUnavailableError(new Error('ECONNREFUSED'))),
      create: vi.fn(),
      setIfVersionMatches: vi.fn(),
      delete: vi.fn(),
    }
    const upstreamRefresh = vi.fn(freshRefresh)

    await expect(
      ensureFreshSession('s1', {
        store: unavailableStore,
        lock: new SimpleLock(),
        verifyBinding: async () => undefined,
        upstreamRefresh,
      })
    ).rejects.toBeInstanceOf(SessionVaultUnavailableError)
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })
})
