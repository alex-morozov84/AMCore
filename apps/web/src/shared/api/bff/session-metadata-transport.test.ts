// @vitest-environment node
import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { proxyOAuthCallback } from './oauth-provider-proxy'
import { sessionMetadataHeaders } from './session-metadata-headers'
import { FakeVaultStore, makeEntry } from './test-fakes'
import { callUpstreamAuth } from './upstream-auth'
import { createUpstreamRefresh } from './upstream-refresh'

vi.mock('server-only', () => ({}))

const browserHeaders = () =>
  new Headers({
    'user-agent': 'Browser current generation',
    'x-real-ip': '8.8.8.8',
    [AMCORE_CLIENT_IP_HEADER]: '1.1.1.1',
    'x-forwarded-for': '9.9.9.9',
  })

beforeEach(() => vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip'))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function assertMetadata(init: RequestInit) {
  const headers = new Headers(init.headers)
  expect(headers.get('user-agent')).toBe('Browser current generation')
  expect(headers.get(AMCORE_CLIENT_IP_HEADER)).toBe('8.8.8.8')
  expect(headers.has('x-forwarded-for')).toBe(false)
  expect(headers.has('x-real-ip')).toBe(false)
}

describe('Session metadata transport boundary', () => {
  it.each(['/auth/login', '/auth/register'] as const)(
    '%s derives metadata without copying forged claims',
    async (path) => {
      const fetchMock = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(JSON.stringify({ user: { id: 'u' }, accessToken: 'access' }), {
            headers: { 'set-cookie': 'refresh_token=rotation; Path=/' },
          })
      )
      vi.stubGlobal('fetch', fetchMock)
      await callUpstreamAuth(
        path,
        {},
        new Request('http://web/api/auth', { headers: browserHeaders() })
      )
      assertMetadata(fetchMock.mock.calls[0]![1] as RequestInit)
    }
  )

  it.each([
    ['google', 'GET'],
    ['apple', 'POST'],
  ])(
    'OAuth %s %s preserves binding and method while deriving metadata',
    async (provider, method) => {
      const fetchMock = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(null, { status: 302, headers: { location: '/callback' } })
      )
      vi.stubGlobal('fetch', fetchMock)
      const headers = browserHeaders()
      const nonceName = provider === 'apple' ? 'oauth_state_apple' : 'oauth_state'
      headers.set('cookie', `${nonceName}=binding; unrelated=must-not-forward`)
      headers.set('accept-language', 'ru')
      if (method === 'POST') headers.set('content-type', 'application/x-www-form-urlencoded')
      await proxyOAuthCallback(
        new Request('http://web/api/oauth/callback?code=probe', {
          method,
          headers,
          ...(method === 'POST' ? { body: 'code=probe&state=binding' } : {}),
        }),
        provider!
      )
      const init = fetchMock.mock.calls[0]![1] as RequestInit
      assertMetadata(init)
      expect(init.method).toBe(method)
      expect(init.redirect).toBe('manual')
      expect(new Headers(init.headers).get('cookie')).toBe(`${nonceName}=binding`)
      expect(new Headers(init.headers).get('accept-language')).toBe('ru')
      if (method === 'POST')
        expect(await new Response(init.body).text()).toBe('code=probe&state=binding')
    }
  )

  it('refresh captures headers per request, uses vault credential and retains abort signal', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ accessToken: 'new-access' }), {
          headers: { 'set-cookie': 'refresh_token=next; Path=/' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = createUpstreamRefresh(browserHeaders())
    const other = browserHeaders()
    other.set('user-agent', 'Second request')
    other.set('x-real-ip', '4.4.4.4')
    const second = createUpstreamRefresh(other)
    const signal = new AbortController().signal
    await first('vault-refresh', signal)
    await second('other-vault', signal)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    assertMetadata(init)
    expect(new Headers(init.headers).get('cookie')).toBe('refresh_token=vault-refresh')
    expect(init.signal).toBe(signal)
    expect(
      new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get('user-agent')
    ).toBe('Second request')
    expect(
      new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get(AMCORE_CLIENT_IP_HEADER)
    ).toBe('4.4.4.4')
  })

  it.each(['', 'invalid'])(
    'disabled/malformed configured claim (%s) never promotes lookalikes',
    (value) => {
      const headers = browserHeaders()
      if (value === '') vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', '')
      else headers.set('x-real-ip', value)
      expect(sessionMetadataHeaders(headers)[AMCORE_CLIENT_IP_HEADER]).toBeUndefined()
    }
  )

  it('explicitly sends empty missing UA to suppress Node default', () => {
    expect(sessionMetadataHeaders(new Headers())['User-Agent']).toBe('')
  })
  it('the lock winner supplies metadata; a waiting request reuses the actual refreshed vault generation', async () => {
    const store = new FakeVaultStore()
    store.seed('shared', makeEntry({ accessTokenExpiresAt: 0 }))
    let finish!: (response: Response) => void, release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let acquired = false
    const lock = {
      acquire: async () => {
        if (acquired) await released
        acquired = true
        return 'lock'
      },
      renew: async () => true,
      release: async () => {
        release()
      },
    }
    const fetchMock = vi.fn(
      (_url: string | URL | Request, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const winner = ensureFreshSession('shared', {
      store,
      lock,
      upstreamRefresh: createUpstreamRefresh(browserHeaders()),
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const waitingHeaders = browserHeaders()
    waitingHeaders.set('user-agent', 'Waiting browser')
    const waiter = ensureFreshSession('shared', {
      store,
      lock,
      upstreamRefresh: createUpstreamRefresh(waitingHeaders),
    })
    finish(
      new Response(JSON.stringify({ accessToken: 'winner-access' }), {
        headers: { 'set-cookie': 'refresh_token=winner-refresh; Path=/' },
      })
    )
    const [first, second] = await Promise.all([winner, waiter])
    expect(first.accessToken).toBe('winner-access')
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    assertMetadata(fetchMock.mock.calls[0]![1] as RequestInit)
  })
})
