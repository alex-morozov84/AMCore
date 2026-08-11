// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

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
      ensureFreshSession('missing', { store, lock: new SimpleLock(), upstreamRefresh: vi.fn() })
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  it('returns the cached entry without refreshing when still fresh', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry())
    const upstreamRefresh = vi.fn(freshRefresh)

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      upstreamRefresh,
    })

    expect(result.accessToken).toBe('at-1')
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })

  it('refreshes and persists a new entry when the access token is stale', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const upstreamRefresh = vi.fn(freshRefresh)

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      upstreamRefresh,
    })

    expect(result.accessToken).toBe('at-2')
    expect(result.version).toBe(2)
    expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    await expect(store.get('s1')).resolves.toMatchObject({ accessToken: 'at-2', version: 2 })
  })

  it('throws SessionLockTimeoutError when the lock cannot be acquired', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new NeverAcquiresLock(),
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
      ensureFreshSession('s1', { store: unavailableStore, lock: new SimpleLock(), upstreamRefresh })
    ).rejects.toBeInstanceOf(SessionVaultUnavailableError)
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })
})
