// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { UpstreamRotationUnprovenError } from './errors'
import { FakeVaultStore, makeBrowserEntry } from './test-fakes'
import { SimpleLock } from './test-lock-fakes'
import { createUpstreamRefresh } from './upstream-refresh'

vi.mock('server-only', () => ({}))

// The real upstream adapter together with the owner: a reply that was never received is not the
// same as a success whose reply cannot be used.
const anchor = 'a'.repeat(43)
const withCookie = (init: Partial<{ ok: boolean; status: number; json: () => Promise<unknown> }>) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ accessToken: 'at-new' }),
    headers: { getSetCookie: () => ['refresh_token=rt-new; Path=/; HttpOnly'] },
    ...init,
  }) as unknown as Response

describe('owner with the real upstream adapter', () => {
  let store: FakeVaultStore
  const run = () =>
    ensureFreshSession('s1', {
      store,
      lock: new SimpleLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh: createUpstreamRefresh(
        new Headers({ cookie: `amcore_browser_context=${anchor}` })
      ),
      timing: { stageMs: 60_000 },
    })

  beforeEach(() => {
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
    store = new FakeVaultStore()
    store.seed('s1', makeBrowserEntry({ accessTokenExpiresAt: Date.now() - 1000 }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('a request that got no response is transient: the session is kept', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(run()).rejects.toMatchObject({ code: 'network' })
    await expect(store.get('s1')).resolves.toMatchObject({ refreshToken: 'rt-1' })
  })

  it.each([
    [
      'an unreadable body',
      withCookie({ json: async () => Promise.reject(new SyntaxError('bad')) }),
    ],
    ['a body without an access token', withCookie({ json: async () => ({}) })],
  ])(
    'a success with %s is a rotation that was not published: terminal, cause kept',
    async (_n, response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UpstreamRotationUnprovenError)
      expect((error as Error).cause).toBeDefined()
      await expect(store.get('s1')).resolves.toBeNull()
    }
  )

  it('a good reply publishes the rotated credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(withCookie({})))
    await expect(run()).resolves.toMatchObject({ refreshToken: 'rt-new', accessToken: 'at-new' })
  })

  it('an explicit invalid token (401) still deletes the stored session', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          withCookie({ ok: false, status: 401, json: async () => ({ errorCode: 'TOKEN_INVALID' }) })
        )
    )
    await expect(run()).rejects.toMatchObject({ code: 'invalid' })
    await expect(store.get('s1')).resolves.toBeNull()
  })
})
