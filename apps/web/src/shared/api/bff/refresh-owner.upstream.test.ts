// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { testAccessToken } from './access-token.testkit'
import { ensureFreshSession } from './ensure-fresh-session'
import { UpstreamRotationUnprovenError } from './errors'
import { FakeVaultStore, makeBrowserEntry } from './test-fakes.testkit'
import { SimpleLock } from './test-lock-fakes'
import { createUpstreamRefresh } from './upstream-refresh'

const atNewToken = testAccessToken('at-new', 2_000_000_000_000)

vi.mock('server-only', () => ({}))

// The real upstream adapter together with the owner: a reply that was never received is not the
// same as a success whose reply cannot be used.
const anchor = 'a'.repeat(43)
const withCookie = (init: Partial<{ ok: boolean; status: number; json: () => Promise<unknown> }>) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ accessToken: atNewToken }),
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
    ['REFRESH_TRANSACTION_TIMEOUT', { status: 503, errorCode: 'REFRESH_TRANSACTION_TIMEOUT' }],
    ['SERVICE_UNAVAILABLE', { code: 'network' }],
  ])('preserves the entry for HTTP 503 %s', async (errorCode, expected) => {
    const send = vi.fn().mockResolvedValue(Response.json({ errorCode }, { status: 503 }))
    vi.stubGlobal('fetch', send)
    const before = await store.get('s1')

    await expect(run()).rejects.toMatchObject(expected)
    expect(send).toHaveBeenCalledOnce()
    expect(await store.get('s1')).toEqual(before)
  })

  it.each([
    [
      'an unreadable body',
      withCookie({ json: async () => Promise.reject(new SyntaxError('bad')) }),
    ],
    ['a body without an access token', withCookie({ json: async () => ({}) })],
    [
      'an access token without usable expiry',
      withCookie({ json: async () => ({ accessToken: 'opaque' }) }),
    ],
  ])(
    'a success with %s is a rotation that was not published: terminal, cause kept',
    async (_n, response) => {
      const send = vi.fn().mockResolvedValue(response)
      vi.stubGlobal('fetch', send)
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UpstreamRotationUnprovenError)
      expect((error as Error).cause).toBeDefined()
      await expect(store.get('s1')).resolves.toBeNull()
      expect(send).toHaveBeenCalledOnce()
    }
  )

  it('a good reply publishes the rotated credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(withCookie({})))
    await expect(run()).resolves.toMatchObject({
      refreshToken: 'rt-new',
      accessToken: atNewToken,
    })
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
