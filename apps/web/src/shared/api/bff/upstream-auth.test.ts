// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { callUpstreamAuth, callUpstreamRegister, UpstreamAuthError } from './upstream-auth'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

function fakeResponse(options: {
  ok: boolean
  status: number
  body: unknown
  setCookieHeaders?: string[]
}) {
  return {
    ok: options.ok,
    status: options.status,
    json: async () => options.body,
    headers: { getSetCookie: () => options.setCookieHeaders ?? [] },
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callUpstreamAuth', () => {
  it('extracts the refresh_token cookie value and returns user/accessToken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 200,
          body: { user: { id: 'u1' }, accessToken: 'at-1' },
          setCookieHeaders: ['refresh_token=rt-1; Path=/; HttpOnly; SameSite=Strict'],
        })
      )
    )

    const result = await callUpstreamAuth(
      '/auth/login',
      { email: 'a@b.com', password: 'x' },
      new Request('http://web.test')
    )

    expect(result).toEqual({ user: { id: 'u1' }, accessToken: 'at-1', refreshToken: 'rt-1' })
  })

  it('finds refresh_token among multiple Set-Cookie headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 200,
          body: { user: { id: 'u1' }, accessToken: 'at-1' },
          setCookieHeaders: ['other=ignored; Path=/', 'refresh_token=rt-1; Path=/; HttpOnly'],
        })
      )
    )

    const result = await callUpstreamAuth('/auth/login', {}, new Request('http://web.test'))
    expect(result.refreshToken).toBe('rt-1')
  })

  it('throws UpstreamAuthError with the backend status/body on a non-ok response', async () => {
    const errorBody = { errorCode: 'AUTH_INVALID_CREDENTIALS', message: 'bad creds' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401, body: errorBody }))
    )

    await expect(
      callUpstreamAuth('/auth/login', {}, new Request('http://web.test'))
    ).rejects.toMatchObject(new UpstreamAuthError(401, errorBody))
  })

  it('throws if the backend succeeds but never sets a refresh_token cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 200,
          body: { user: { id: 'u1' }, accessToken: 'at-1' },
          setCookieHeaders: [],
        })
      )
    )

    await expect(
      callUpstreamAuth('/auth/login', {}, new Request('http://web.test'))
    ).rejects.toThrow(/did not set/)
  })

  it('forwards browser locale and device metadata from the original request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 201,
        body: { user: { id: 'u1' }, accessToken: 'at-1' },
        setCookieHeaders: ['refresh_token=rt-1; Path=/'],
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const originalRequest = new Request('http://next.internal/api/auth/register', {
      headers: { 'accept-language': 'ru-RU,ru;q=0.9', 'user-agent': 'Browser device probe' },
    })

    await callUpstreamAuth('/auth/register', {}, originalRequest)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Accept-Language')).toBe('ru-RU,ru;q=0.9')
    expect(new Headers(init.headers).get('User-Agent')).toBe('Browser device probe')
  })

  it('omits Accept-Language when the original request has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: { user: { id: 'u1' }, accessToken: 'at-1' },
        setCookieHeaders: ['refresh_token=rt-1; Path=/'],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await callUpstreamAuth('/auth/login', {}, new Request('http://web.test'))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Accept-Language')).toBeNull()
  })
})

describe('callUpstreamRegister (creation evidence)', () => {
  const user = {
    id: 'u1',
    email: 'a@b.com',
    emailVerified: false,
    name: null,
    avatarUrl: null,
    phone: null,
    locale: 'en',
    timezone: 'UTC',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
  }
  const cookie = ['refresh_token=rt-1; Path=/; HttpOnly']

  function respond(init: {
    status: number
    body?: unknown
    cookies?: string[]
    unreadableBody?: boolean
  }) {
    const response = {
      ok: init.status >= 200 && init.status < 300,
      status: init.status,
      json: async () => {
        if (init.unreadableBody) throw new SyntaxError('Unexpected token')
        return init.body
      },
      headers: { getSetCookie: () => init.cookies ?? [] },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  }
  const call = () => callUpstreamRegister('/auth/register', {}, new Request('http://web.test'))

  it('confirms creation only for exactly 201 with a valid body', async () => {
    respond({ status: 201, body: { user, accessToken: 'at-1' }, cookies: cookie })
    await expect(call()).resolves.toEqual({
      outcome: 'created',
      user,
      accessToken: 'at-1',
      refreshToken: 'rt-1',
    })
  })

  it('still confirms creation when the session cookie is missing, with no cookie to revoke', async () => {
    respond({ status: 201, body: { user, accessToken: 'at-1' } })
    await expect(call()).resolves.toMatchObject({ outcome: 'created', refreshToken: null })
  })

  it.each([200, 202, 204])('does not treat a %s success as creation', async (status) => {
    respond({ status, body: { user, accessToken: 'at-1' }, cookies: cookie })
    await expect(call()).resolves.toEqual({ outcome: 'unknown', refreshToken: 'rt-1' })
  })

  it.each([
    ['an unreadable body', { unreadableBody: true }],
    ['a body without the auth fields', { body: { user: { id: 'u1' } } }],
    ['an empty body', { body: null }],
  ])('treats 201 with %s as unknown, keeping the cookie for cleanup', async (_label, extra) => {
    respond({ status: 201, cookies: cookie, ...extra })
    await expect(call()).resolves.toEqual({ outcome: 'unknown', refreshToken: 'rt-1' })
  })

  it.each([409, 500, 503])('forwards an upstream %s as an upstream error', async (status) => {
    respond({ status, body: { errorCode: 'X' } })
    await expect(call()).rejects.toBeInstanceOf(UpstreamAuthError)
  })

  it('lets a transport failure through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(call()).rejects.toBeInstanceOf(TypeError)
  })
})
