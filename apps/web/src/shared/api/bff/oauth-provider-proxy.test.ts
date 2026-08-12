// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { proxyOAuthAuthorize, proxyOAuthCallback } from './oauth-provider-proxy'

vi.mock('server-only', () => ({}))

function fakeUpstream(init: {
  status?: number
  location?: string
  setCookie?: string[]
  body?: BodyInit | null
}): Response {
  const headers = new Headers()
  if (init.location) headers.set('location', init.location)
  return {
    status: init.status ?? 302,
    headers: {
      get: (name: string) => headers.get(name),
      getSetCookie: () => init.setCookie ?? [],
    },
    body: init.body ?? null,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('proxyOAuthAuthorize', () => {
  it('forwards to the backend init endpoint with manual redirect and relays Location + Set-Cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeUpstream({
        location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
        setCookie: ['oauth_state=nonce-1; Path=/; HttpOnly; SameSite=Lax'],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('http://next.internal/api/auth/oauth/google', {
      headers: { 'accept-language': 'ru' },
    })
    const response = await proxyOAuthAuthorize(request, 'google')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:5002/api/v1/auth/oauth/google')
    expect(init.redirect).toBe('manual')
    expect((init.headers as Headers).get('accept-language')).toBe('ru')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'
    )
    expect(response.headers.get('set-cookie')).toBe(
      'oauth_state=nonce-1; Path=/; HttpOnly; SameSite=Lax'
    )
  })

  it('preserves the query string on the upstream URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeUpstream({}))
    vi.stubGlobal('fetch', fetchMock)

    await proxyOAuthAuthorize(
      new Request('http://next.internal/api/auth/oauth/google?foo=bar'),
      'google'
    )

    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.search).toBe('?foo=bar')
  })
})

describe('proxyOAuthCallback', () => {
  it('GET forwards the browser Cookie header upstream (needed for the binding-nonce check)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeUpstream({ location: '/en/auth/callback?ticket=t1' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request(
      'http://next.internal/api/auth/oauth/google/callback?code=c&state=s',
      {
        headers: { cookie: 'oauth_state=nonce-1' },
      }
    )
    const response = await proxyOAuthCallback(request, 'google')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'http://localhost:5002/api/v1/auth/oauth/google/callback?code=c&state=s'
    )
    expect((init.headers as Headers).get('cookie')).toBe('oauth_state=nonce-1')
    expect(response.headers.get('location')).toBe('/en/auth/callback?ticket=t1')
  })

  it('rewrites the Apple binding cookie path on the callback leg too', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeUpstream({
        setCookie: [
          'oauth_state_apple=; Path=/api/v1/auth/oauth/apple/callback; Expires=Thu, 01 Jan 1970',
        ],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await proxyOAuthCallback(
      new Request('http://next.internal/api/auth/oauth/apple/callback', { method: 'POST' }),
      'apple'
    )

    expect(response.headers.get('set-cookie')).toContain('Path=/api/auth/oauth/apple/callback')
  })

  it('forwards a POST body and Content-Type for Apple form_post', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeUpstream({}))
    vi.stubGlobal('fetch', fetchMock)

    const request = new Request('http://next.internal/api/auth/oauth/apple/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=c&state=s',
    })
    await proxyOAuthCallback(request, 'apple')

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { duplex?: string }]
    expect(init.method).toBe('POST')
    expect((init.headers as Headers).get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(init.body).toBeInstanceOf(ReadableStream)
    expect(init.duplex).toBe('half')
  })

  it('rejects a POST for a non-form_post provider with 405, never reaching the backend', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await proxyOAuthCallback(
      new Request('http://next.internal/api/auth/oauth/google/callback', { method: 'POST' }),
      'google'
    )

    expect(response.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
