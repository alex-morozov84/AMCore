// @vitest-environment node
import { cookies } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyToBackend } from './authenticated-proxy'
import { makeRequest, mockCookieStore } from './authenticated-proxy.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { SessionNotFoundError, SessionVaultUnavailableError } from './errors'
import { isTrustedOrigin } from './origin-guard'
import { upstreamRefresh } from './upstream-refresh'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))

describe('proxyToBackend — session/CSRF gating and auth-failure classification', () => {
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
  })

  afterEach(() => vi.unstubAllGlobals())

  describe.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'credential denial for %s',
    (method) => {
      it.each([
        ['auth', 'login'],
        ['auth', 'register'],
        ['auth', 'refresh'],
        ['auth', 'step-up'],
        ['auth', 'oauth', 'exchange'],
        ['organizations', 'OrgID', 'switch'],
        ['Organizations', 'x/y', 'SWITCH'],
        ['Auth', 'LOGIN'],
        ['x', '..', 'auth', 'login'],
        ['auth', '.', 'login'],
        ['..', 'v1', 'auth', 'login'],
        ['auth', 'refresh', ''],
      ])('rejects %j without any auth or upstream work', async (...segments) => {
        vi.mocked(cookies).mockRejectedValue(new Error('vault unavailable'))
        vi.mocked(ensureFreshSession).mockRejectedValue(new Error('vault unavailable'))
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const response = await proxyToBackend(makeRequest('probe?case=1', { method }), segments)
        expect(response.status).toBe(404)
        expect(cookies).not.toHaveBeenCalled()
        expect(isTrustedOrigin).not.toHaveBeenCalled()
        expect(ensureFreshSession).not.toHaveBeenCalled()
        expect(upstreamRefresh).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
      })
    }
  )

  it.each([
    ['auth', 'me'],
    ['auth/login'],
    ['auth', '%6cogin'],
    ['organizations', 'id', 'switching'],
  ])('does not broaden denial to %j', async (...segments) => {
    mockCookieStore(undefined)
    const response = await proxyToBackend(makeRequest('probe'), segments)
    expect(response.status).toBe(401)
  })

  it('returns 401 when there is no session cookie, without touching ensureFreshSession', async () => {
    mockCookieStore(undefined)

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(401)
    expect(ensureFreshSession).not.toHaveBeenCalled()
  })

  it('rejects a state-changing request from an untrusted origin before touching the session', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)
    mockCookieStore('sess-1')

    const response = await proxyToBackend(makeRequest('users/me', { method: 'POST' }), [
      'users',
      'me',
    ])

    expect(response.status).toBe(403)
    expect(ensureFreshSession).not.toHaveBeenCalled()
  })

  it('maps SessionNotFoundError to 401', async () => {
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(new SessionNotFoundError('sess-1'))

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(401)
  })

  it('maps SessionVaultUnavailableError to 503 (fail closed, not logged out)', async () => {
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(503)
  })

  it('maps an invalid-refresh-token rejection (code: "invalid") to 401', async () => {
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      Object.assign(new Error('refresh rejected'), { code: 'invalid' })
    )

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(401)
  })

  it('maps a transient refresh failure (code: "network") to 503, not 401/logout', async () => {
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      Object.assign(new Error('backend 503'), { code: 'network' })
    )

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(503)
  })

  it('maps an uncoded raw fetch-style exception to a controlled 503, not an unhandled crash', async () => {
    mockCookieStore('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(new TypeError('fetch failed'))

    const response = await proxyToBackend(makeRequest('users/me'), ['users', 'me'])

    expect(response.status).toBe(503)
  })
})
