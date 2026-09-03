// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyToBackend } from './authenticated-proxy'
import { makeRequest, mockCookieStore } from './authenticated-proxy.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))

describe('proxyToBackend — request/response forwarding once authenticated', () => {
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue({ accessToken: 'at-1' } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.WEB_TRUSTED_CLIENT_IP_HEADER
  })

  it('does not CSRF-check a safe GET request even from an untrusted origin', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(200)
  })

  it('proxies with the vault access token attached and forwards status/body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/users/me')
    expect((init.headers as Headers).get('authorization')).toBe('Bearer at-1')
  })

  it('forwards the query string to the upstream URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await proxyToBackend(makeRequest('users?page=2&limit=10'), ['users'])

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:5002/api/v1/users?page=2&limit=10')
  })

  it('streams a request body upstream with duplex "half"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = makeRequest('users', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
      headers: { 'content-type': 'application/json' },
    })

    await proxyToBackend(request, ['users'])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }]
    expect(init.duplex).toBe('half')
    expect(init.body).not.toBeNull()
  })

  it('strips the browser Origin/Referer before the server-to-server upstream call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = makeRequest('users/me', {
      headers: { origin: 'http://localhost:3002', referer: 'http://localhost:3002/dashboard' },
    })

    await proxyToBackend(request, ['users', 'me'])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Headers
    expect(headers.has('origin')).toBe(false)
    expect(headers.has('referer')).toBe(false)
  })

  it('does not set x-amcore-client-ip upstream when the web-side resolver is disabled (default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = makeRequest('users/me', { headers: { 'x-real-ip': '203.0.113.7' } })
    await proxyToBackend(request, ['users', 'me'])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).has('x-amcore-client-ip')).toBe(false)
  })

  it('relays the trusted inbound IP as x-amcore-client-ip once the web-side resolver is enabled', async () => {
    process.env.WEB_TRUSTED_CLIENT_IP_HEADER = 'x-real-ip'
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const request = makeRequest('users/me', { headers: { 'x-real-ip': '203.0.113.7' } })
    await proxyToBackend(request, ['users', 'me'])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get('x-amcore-client-ip')).toBe('203.0.113.7')
  })

  it('never relays a browser-supplied x-amcore-client-ip, resolver enabled or not', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // No WEB_TRUSTED_CLIENT_IP_HEADER configured — the browser's own claim
    // must not survive even though nothing legitimate replaces it either.
    const request = makeRequest('users/me', { headers: { 'x-amcore-client-ip': '9.9.9.9' } })
    await proxyToBackend(request, ['users', 'me'])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).has('x-amcore-client-ip')).toBe(false)
  })
})
