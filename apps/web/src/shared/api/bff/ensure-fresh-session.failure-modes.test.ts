// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { SessionRefreshUnsafeError } from './errors'
import type { UpstreamRefreshFn } from './session-vault.types'
import { FakeVaultStore, makeEntry } from './test-fakes'
import { FailingRenewalLock, RejectingRenewalLock, SimpleLock } from './test-lock-fakes'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

const neverSettles = () => new Promise<Awaited<ReturnType<UpstreamRefreshFn>>>(() => {})

describe('ensureFreshSession — failure classification', () => {
  it('deletes the vault entry when the upstream reports an invalid/reused refresh token', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const upstreamError = Object.assign(new Error('reuse detected'), { code: 'reuse-detected' })
    const upstreamRefresh: UpstreamRefreshFn = vi.fn(async () => {
      throw upstreamError
    })

    await expect(
      ensureFreshSession('s1', { store, lock: new SimpleLock(), upstreamRefresh })
    ).rejects.toBe(upstreamError)
    await expect(store.get('s1')).resolves.toBeNull()
  })

  it('does NOT delete the vault entry on a transient upstream failure (no invalid/reuse code)', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const networkError = new Error('fetch failed')
    const upstreamRefresh: UpstreamRefreshFn = vi.fn(async () => {
      throw networkError
    })

    await expect(
      ensureFreshSession('s1', { store, lock: new SimpleLock(), upstreamRefresh })
    ).rejects.toBe(networkError)
    await expect(store.get('s1')).resolves.not.toBeNull()
  })

  it('fails closed and deletes the vault when lock renewal is refused while a refresh is in flight', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeVaultStore()
      store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

      const pending = ensureFreshSession('s1', {
        store,
        lock: new FailingRenewalLock(),
        upstreamRefresh: vi.fn(neverSettles),
      }).catch((e: unknown) => e)

      // One renewal cycle (every 4s) is enough — FailingRenewalLock always refuses.
      await vi.advanceTimersByTimeAsync(4_100)
      const error = await pending

      expect(error).toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed and deletes the vault when a renew() call rejects (not just returns false)', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeVaultStore()
      store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

      const pending = ensureFreshSession('s1', {
        store,
        lock: new RejectingRenewalLock(),
        upstreamRefresh: vi.fn(neverSettles),
      }).catch((e: unknown) => e)

      await vi.advanceTimersByTimeAsync(4_100)
      const error = await pending

      expect(error).toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed via the absolute ceiling if the upstream refresh never settles, even with successful renewals', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeVaultStore()
      store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

      const pending = ensureFreshSession('s1', {
        store,
        lock: new SimpleLock(), // renew() always succeeds
        upstreamRefresh: vi.fn(neverSettles),
      }).catch((e: unknown) => e)

      await vi.runAllTimersAsync()
      const error = await pending

      expect(error).toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
