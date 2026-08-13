// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureFreshSession } from './ensure-fresh-session'
import { SessionNotFoundError, SessionVaultUnavailableError } from './errors'
import { handleGetSessions } from './sessions-handler'
import { fakeVaultEntry, mockSessionCookie } from './sessions-handler.test-helpers'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))

function makeRequest(query = ''): Request {
  return new Request(`http://next.internal/api/auth/sessions${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleGetSessions', () => {
  it('returns 401 without calling the backend when there is no session cookie', async () => {
    mockSessionCookie(undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleGetSessions(makeRequest())

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503, not 401, when auth could not be proven', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )

    const response = await handleGetSessions(makeRequest())

    expect(response.status).toBe(503)
  })

  it('returns 401 when the session is genuinely gone', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(new SessionNotFoundError('sess-1'))

    const response = await handleGetSessions(makeRequest())

    expect(response.status).toBe(401)
  })

  it('forwards to the backend with both Bearer and refresh_token Cookie, preserving the query string', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [], total: 0, page: 1, limit: 20 }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleGetSessions(makeRequest('?page=2&limit=10'))

    expect(response.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:5002/api/v1/auth/sessions?page=2&limit=10')
    const headers = init.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer at-1')
    expect(headers.get('Cookie')).toBe('refresh_token=rt-1')
  })
})
