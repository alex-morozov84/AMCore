// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  isConsoleRequestOriginTrusted: vi.fn(),
  resolveConsoleAccessToken: vi.fn(),
}))
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { handleConsoleAuditLookup } from './audit-lookup'
import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

function request(body: unknown): Request {
  return new Request('https://console.example.test/api/console/audit/lookup', {
    method: 'POST',
    headers: { origin: 'https://console.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({ token: 'vault-only-token' })
})

describe('Audit name lookup boundary', () => {
  it('rejects untrusted origin and bad search before resolving credentials', async () => {
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    expect(
      (await handleConsoleAuditLookup(request({ kind: 'user', search: 'alice' }))).status
    ).toBe(403)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
    expect((await handleConsoleAuditLookup(request({ kind: 'user', search: 'x' }))).status).toBe(
      400
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns only the first ten safe fields and tells the operator to refine', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'org1',
            name: 'Current Org',
            slug: 'current-org',
            createdAt: '2026-09-23T00:00:00.000Z',
            updatedAt: '2026-09-23T00:00:00.000Z',
            secret: 'do-not-forward',
          },
        ],
        total: 11,
        page: 1,
        limit: 10,
      })
    )
    const response = await handleConsoleAuditLookup(
      request({ kind: 'organization', search: 'Current' })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({
      kind: 'organization',
      hasMore: true,
      items: [{ id: 'org1', name: 'Current Org', slug: 'current-org' }],
    })
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/admin/organizations?page=1&limit=10&search=Current')
    expect(options.cache).toBe('no-store')
    expect((options.headers as Headers).get('authorization')).toBe('Bearer vault-only-token')
  })

  it('keeps upstream failure responses content-free', async () => {
    fetchMock.mockResolvedValue(Response.json({ token: 'secret' }, { status: 403 }))
    const response = await handleConsoleAuditLookup(request({ kind: 'user', search: 'alice' }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
})
