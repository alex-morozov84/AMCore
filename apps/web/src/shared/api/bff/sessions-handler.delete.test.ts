// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'
import { handleDeleteOtherSessions, handleDeleteSession } from './sessions-handler'
import { fakeVaultEntry, mockSessionCookie } from './sessions-handler.test-helpers'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))

function makeRequest(): Request {
  return new Request('http://next.internal/api/auth/sessions', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isTrustedOrigin).mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleDeleteSession', () => {
  it('rejects an untrusted origin with 403 before touching the session', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)

    const response = await handleDeleteSession(makeRequest(), 'target-id')

    expect(response.status).toBe(403)
    expect(ensureFreshSession).not.toHaveBeenCalled()
  })

  it('forwards DELETE to the backend with the target session id and both auth headers', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleDeleteSession(makeRequest(), 'target-id')

    expect(response.status).toBe(204)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/sessions/target-id')
    expect(init.method).toBe('DELETE')
    const headers = init.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer at-1')
    expect(headers.get('Cookie')).toBe('refresh_token=rt-1')
  })
})

describe('handleDeleteOtherSessions', () => {
  it('rejects an untrusted origin with 403 before touching the session', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)

    const response = await handleDeleteOtherSessions(makeRequest())

    expect(response.status).toBe(403)
    expect(ensureFreshSession).not.toHaveBeenCalled()
  })

  it('forwards DELETE /auth/sessions (no id) with both auth headers', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleDeleteOtherSessions(makeRequest())

    expect(response.status).toBe(204)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:5002/api/v1/auth/sessions')
  })
})
