// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { callUpstreamAuth, UpstreamAuthError } from './upstream-auth'

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

    const result = await callUpstreamAuth('/auth/login', { email: 'a@b.com', password: 'x' })

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

    const result = await callUpstreamAuth('/auth/login', {})
    expect(result.refreshToken).toBe('rt-1')
  })

  it('throws UpstreamAuthError with the backend status/body on a non-ok response', async () => {
    const errorBody = { errorCode: 'AUTH_INVALID_CREDENTIALS', message: 'bad creds' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401, body: errorBody }))
    )

    await expect(callUpstreamAuth('/auth/login', {})).rejects.toMatchObject(
      new UpstreamAuthError(401, errorBody)
    )
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

    await expect(callUpstreamAuth('/auth/login', {})).rejects.toThrow(/did not set/)
  })

  it('forwards Accept-Language from the original browser request', async () => {
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
      headers: { 'accept-language': 'ru-RU,ru;q=0.9' },
    })

    await callUpstreamAuth('/auth/register', {}, originalRequest)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('ru-RU,ru;q=0.9')
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

    await callUpstreamAuth('/auth/login', {})

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Accept-Language']).toBeUndefined()
  })
})
