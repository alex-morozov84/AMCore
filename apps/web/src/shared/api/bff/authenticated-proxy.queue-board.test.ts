// @vitest-environment node
import { cookies } from 'next/headers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { proxyToBackend } from './authenticated-proxy'
import { makeRequest } from './authenticated-proxy.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'
import { createUpstreamRefresh } from './upstream-refresh'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn(async () => new Headers()) }))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn(() => true) }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ createUpstreamRefresh: vi.fn(() => vi.fn()) }))

/**
 * The queue board has its own Console route. The generic product proxy must never carry a session's
 * bearer to the board's mount, in any method, any letter case or any encoding of the path.
 */
describe('proxyToBackend — the queue board is closed to the generic proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  describe.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'for %s',
    (method) => {
      it.each([
        ['admin', 'queues'],
        ['admin', 'queues', ''],
        ['admin', 'queues', 'api', 'queues'],
        ['admin', 'queues', 'static', 'js', 'main.js'],
        ['ADMIN', 'Queues', 'api', 'queues'],
        ['admin', 'queues', '..', 'queues', 'api', 'queues'],
        ['x', '..', 'admin', 'queues'],
        ['admin/queues'],
        ['admin%2Fqueues'],
        ['admin', 'queues%2Fapi'],
        ['%61dmin', 'queues'],
        ['admin', '%2e%2e', 'admin', 'queues'],
        ['admin\\queues'],
      ])('answers 404 for %j before any auth, origin or upstream work', async (...segments) => {
        vi.mocked(cookies).mockRejectedValue(new Error('vault unavailable'))
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const response = await proxyToBackend(makeRequest('probe?case=1', { method }), segments)
        expect(response.status).toBe(404)
        expect(cookies).not.toHaveBeenCalled()
        expect(isTrustedOrigin).not.toHaveBeenCalled()
        expect(ensureFreshSession).not.toHaveBeenCalled()
        expect(createUpstreamRefresh).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
      })
    }
  )

  it.each([
    ['admin', 'background-work', 'queues'],
    ['admin', 'queues-archive'],
    ['admin', 'users'],
    ['queues'],
  ])('does not close the unrelated path %j', async (...segments) => {
    vi.mocked(cookies).mockRejectedValue(new Error('vault unavailable'))
    vi.stubGlobal('fetch', vi.fn())
    // The session step (made to fail here) is reached: the path was not closed by the board rule.
    await expect(proxyToBackend(makeRequest('probe', { method: 'GET' }), segments)).rejects.toThrow(
      'vault unavailable'
    )
    expect(cookies).toHaveBeenCalled()
  })
})
