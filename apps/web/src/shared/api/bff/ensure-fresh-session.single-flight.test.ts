// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { SessionLockTimeoutError } from './errors'
import type { UpstreamRefreshFn } from './session-vault.types'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes'
import { QueuedFakeLock, SimpleLock, TtlAwareFakeLock } from './test-lock-fakes'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

describe('ensureFreshSession — single-flight refresh protocol', () => {
  it('a second caller re-reads after the lock and does not refresh twice', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const lock = new QueuedFakeLock()
    const upstreamRefresh = vi.fn(freshRefresh)
    const deps = { store, lock, upstreamRefresh }

    const [first, second] = await Promise.all([
      ensureFreshSession('s1', deps),
      ensureFreshSession('s1', deps),
    ])

    expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    expect(first.accessToken).toBe('at-2')
    expect(second.accessToken).toBe('at-2')
  })

  it('a version mismatch on write does not overwrite a newer vault entry', async () => {
    const store = new FakeVaultStore()
    const stale = makeEntry({ accessTokenExpiresAt: Date.now() - 1000, version: 1 })
    store.seed('s1', stale)

    // Simulate another writer racing in between this refresh's re-read and
    // its write — despite the lock, `setIfVersionMatches` must reject it.
    const upstreamRefresh: UpstreamRefreshFn = vi.fn(async () => {
      await store.setIfVersionMatches('s1', 1, {
        ...stale,
        accessToken: 'at-other-writer',
        refreshToken: 'rt-other-writer',
        accessTokenExpiresAt: Date.now() + 120_000,
      })
      return {
        accessToken: 'at-mine',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-mine',
      }
    })

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      upstreamRefresh,
    })

    expect(result.accessToken).toBe('at-other-writer')
  })

  it('lock renewal keeps a second caller from entering refresh once the original TTL would have expired', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeVaultStore()
      store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
      const lock = new TtlAwareFakeLock()

      let resolveUpstream!: (r: Awaited<ReturnType<UpstreamRefreshFn>>) => void
      const upstreamRefresh: UpstreamRefreshFn = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<UpstreamRefreshFn>>>(
            (resolve) => (resolveUpstream = resolve)
          )
      )

      const firstPending = ensureFreshSession('s1', { store, lock, upstreamRefresh })

      // Past the original 10s lock TTL — only still blocked if renewal
      // (every 4s) actually extended the lease.
      await vi.advanceTimersByTimeAsync(12_000)

      const secondAttempt = ensureFreshSession('s1', {
        store,
        lock,
        upstreamRefresh: vi.fn(freshRefresh),
      })
      await expect(secondAttempt).rejects.toBeInstanceOf(SessionLockTimeoutError)

      resolveUpstream({
        accessToken: 'at-2',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-2',
      })
      await vi.advanceTimersByTimeAsync(0)
      await expect(firstPending).resolves.toMatchObject({ accessToken: 'at-2' })
    } finally {
      vi.useRealTimers()
    }
  })
})
