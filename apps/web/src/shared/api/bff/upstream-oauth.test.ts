// @vitest-environment node
import { DEFAULT_LOCALE } from '@amcore/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))
const exampleUser = {
  id: 'u1',
  email: 'example@example.test',
  name: null,
  phone: null,
  avatarUrl: null,
  locale: DEFAULT_LOCALE,
  timezone: 'UTC',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callUpstreamOAuthExchange', () => {
  it('POSTs the ticket with the refresh token as a Cookie header and returns the complete exchange envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accessToken: 'at-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const accessToken = await callUpstreamOAuthExchange('ticket-1', 'rt-1')

    expect(accessToken).toEqual({ accessToken: 'at-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/oauth/exchange')
    expect(init.method).toBe('POST')
    const headers = init.headers as Headers
    expect(headers.get('cookie')).toBe('refresh_token=rt-1')
    expect(JSON.parse(init.body as string)).toEqual({ ticket: 'ticket-1' })
  })

  it('throws UpstreamOAuthError with a safe backend status and no diagnostic body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'invalid' }), { status: 401 }))
    )

    await expect(callUpstreamOAuthExchange('ticket-1', 'rt-1')).rejects.toMatchObject({
      status: 401,
      body: null,
    })
  })
})

describe('fetchCurrentUser', () => {
  it('sends the access token as a Bearer header and returns the user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: exampleUser }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await fetchCurrentUser('at-1')

    expect(user).toEqual(exampleUser)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/me')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer at-1')
  })

  it('returns null when the backend reports no user for the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }))
    )

    expect(await fetchCurrentUser('at-1')).toBeNull()
  })

  it('throws UpstreamOAuthError on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    await expect(fetchCurrentUser('at-1')).rejects.toBeInstanceOf(UpstreamOAuthError)
  })
})
