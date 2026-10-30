// @vitest-environment node
import { cookies } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import { getCurrentVaultSession } from './current-session'
import { FakeVaultStore, makeEntry } from './test-fakes'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers({ cookie: `amcore_browser_context=${'a'.repeat(43)}` })),
}))

const browser = {
  contextId: 'context',
  generation: 1,
  audience: 'product' as const,
  familyId: 'family',
  securityVersion: 0,
}
const probe = vi.fn()
beforeEach(() => {
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
  probe
    .mockReset()
    .mockImplementation(async () =>
      Response.json({ status: 'current', userId: 'actor', ...browser })
    )
  vi.stubGlobal('fetch', probe)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function boundEntry(extra = {}) {
  return makeEntry({
    audience: 'product',
    browser,
    userSnapshot: { id: 'actor' } as never,
    ...extra,
  })
}

function mockCookieStore(sessionId: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(sessionId ? { value: sessionId } : undefined),
  } as never)
}

describe('getCurrentVaultSession', () => {
  it('rejects a primary context change instead of returning the Redis snapshot', async () => {
    mockCookieStore('sess-1')
    const store = new FakeVaultStore()
    store.seed('sess-1', boundEntry())
    probe.mockResolvedValue(Response.json({ errorCode: 'AUTH_CONTEXT_CHANGED' }, { status: 401 }))
    await expect(getCurrentVaultSession(store)).rejects.toBeInstanceOf(ContextRequestError)
    expect(probe).toHaveBeenCalledOnce()
  })
  it('rejects an unbound legacy entry before exposing identity', async () => {
    mockCookieStore('sess-1')
    const store = new FakeVaultStore()
    store.seed('sess-1', makeEntry())
    await expect(getCurrentVaultSession(store)).rejects.toMatchObject({ status: 401 })
    expect(probe).not.toHaveBeenCalled()
  })

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
    const entry = boundEntry()
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
    store.seed('sess-1', boundEntry({ accessTokenExpiresAt: Date.now() - 1000 }))

    const result = await getCurrentVaultSession(store)

    expect(result?.entry.accessToken).toBe('at-1')
  })
})
