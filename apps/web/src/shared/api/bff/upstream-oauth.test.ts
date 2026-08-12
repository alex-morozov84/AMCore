// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callUpstreamOAuthExchange', () => {
  it('POSTs the ticket with the refresh token as a Cookie header and returns the access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accessToken: 'at-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const accessToken = await callUpstreamOAuthExchange('ticket-1', 'rt-1')

    expect(accessToken).toBe('at-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/oauth/exchange')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Cookie).toBe('refresh_token=rt-1')
    expect(JSON.parse(init.body as string)).toEqual({ ticket: 'ticket-1' })
  })

  it('throws UpstreamOAuthError with the backend status and body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'invalid' }), { status: 401 }))
    )

    await expect(callUpstreamOAuthExchange('ticket-1', 'rt-1')).rejects.toMatchObject({
      status: 401,
      body: { message: 'invalid' },
    })
  })
})

describe('fetchCurrentUser', () => {
  it('sends the access token as a Bearer header and returns the user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = await fetchCurrentUser('at-1')

    expect(user).toEqual({ id: 'u1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/me')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1')
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
