// @vitest-environment node
import { cookies } from 'next/headers'
import { describe, expect, it, vi } from 'vitest'

import { getCurrentVaultSession } from './current-session'
import { FakeVaultStore, makeEntry } from './test-fakes'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

function mockCookieStore(sessionId: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(sessionId ? { value: sessionId } : undefined),
  } as never)
}

describe('getCurrentVaultSession', () => {
  it('returns null when there is no session cookie', async () => {
    mockCookieStore(undefined)
    await expect(getCurrentVaultSession(new FakeVaultStore())).resolves.toBeNull()
  })

  it('returns null when the cookie points at a vault entry that no longer exists', async () => {
    mockCookieStore('sess-missing')
    await expect(getCurrentVaultSession(new FakeVaultStore())).resolves.toBeNull()
  })

  it('returns the session id and vault entry when both exist', async () => {
    mockCookieStore('sess-1')
    const store = new FakeVaultStore()
    const entry = makeEntry()
    store.seed('sess-1', entry)

    await expect(getCurrentVaultSession(store)).resolves.toEqual({
      sessionId: 'sess-1',
      entry,
    })
  })

  it('does not call ensureFreshSession or any refresh path — a raw read only', async () => {
    // No upstreamRefresh/lock is even constructible here; if this function
    // tried to refresh, it would need those dependencies and this test
    // would fail to compile/run without them.
    mockCookieStore('sess-1')
    const store = new FakeVaultStore()
    store.seed('sess-1', makeEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

    const result = await getCurrentVaultSession(store)

    expect(result?.entry.accessToken).toBe('at-1')
  })
})
