// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { testAccessToken } from './access-token.testkit'
import { ensureFreshSession } from './ensure-fresh-session'
import { SessionLockTimeoutError } from './errors'
import type { UpstreamRefreshFn } from './session-vault.types'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes.testkit'
import { QueuedFakeLock, SimpleLock, TtlAwareFakeLock } from './test-lock-fakes'

const atMineToken = testAccessToken('at-mine', 2_000_000_000_000)

const atOtherWriterToken = testAccessToken('at-other-writer', 2_000_000_000_000)

const at2Token = testAccessToken('at-2', 2_000_000_000_000)

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

describe('ensureFreshSession — single-flight refresh protocol', () => {
  it('a second caller re-reads after the lock and does not refresh twice', async () => {
    const store = new FakeVaultStore()
    store.seed('s1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
    const lock = new QueuedFakeLock()
    const upstreamRefresh = vi.fn(freshRefresh)
    const deps = { store, lock, verifyBinding: async () => undefined, upstreamRefresh }

    const [first, second] = await Promise.all([
      ensureFreshSession('s1', deps),
      ensureFreshSession('s1', deps),
    ])

    expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    expect(first.refreshToken).toBe('rt-2')
    expect(second.accessToken).toBe(first.accessToken)
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
        accessToken: atOtherWriterToken,
        refreshToken: 'rt-other-writer',
        accessTokenExpiresAt: Date.now() + 120_000,
      })
      return {
        accessToken: atMineToken,
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-mine',
      }
    })

    const result = await ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh,
    })

    expect(result.accessToken).toBe(atOtherWriterToken)
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

      const firstPending = ensureFreshSession('s1', {
        store,
        lock,
        verifyBinding: async () => undefined,
        upstreamRefresh,
        timing: { stageMs: 60_000 },
      })

      // Past the original 10s lock TTL — only still blocked if renewal
      // (every 4s) actually extended the lease.
      await vi.advanceTimersByTimeAsync(12_000)

      // Another process: its own lock object over the same shared lock state.
      const otherProcessLock = {
        acquire: lock.acquire.bind(lock),
        renew: lock.renew.bind(lock),
        release: lock.release.bind(lock),
      }
      const secondAttempt = ensureFreshSession('s1', {
        store,
        lock: otherProcessLock,
        verifyBinding: async () => undefined,
        upstreamRefresh: vi.fn(freshRefresh),
        timing: { stageMs: 60_000 },
      })
      await expect(secondAttempt).rejects.toBeInstanceOf(SessionLockTimeoutError)

      resolveUpstream({
        accessToken: at2Token,
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-2',
      })
      await vi.advanceTimersByTimeAsync(0)
      await expect(firstPending).resolves.toMatchObject({ accessToken: at2Token })
    } finally {
      vi.useRealTimers()
    }
  })
})
