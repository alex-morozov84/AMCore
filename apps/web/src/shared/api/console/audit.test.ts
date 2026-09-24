// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/server/auth-header', () => ({ resolveAuthHeader: vi.fn() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: vi.fn() }))
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { resolveAuthHeader } from '@/shared/api/server/auth-header'

import { auditQueryString, fetchConsoleAudit } from './audit'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAuthHeader).mockResolvedValue({ header: 'Bearer console-token' })
})

describe('Console audit server fetch', () => {
  it('builds a fixed query and explicitly disables caching', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        items: [],
        hasMore: false,
        nextCursor: null,
        from: '2026-09-16T00:00:00.000Z',
        to: '2026-09-23T00:00:00.000Z',
      })
    )
    const outcome = await fetchConsoleAudit({ actorId: 'user1', limit: 25 })
    expect(outcome.status).toBe('success')
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/admin/audit-logs?actorId=user1&limit=25')
    expect(options.cache).toBe('no-store')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer console-token' })
  })

  it('does not fetch if the console token source is unavailable', async () => {
    vi.mocked(resolveAuthHeader).mockResolvedValue({ unavailable: true })
    expect(await fetchConsoleAudit({})).toMatchObject({ status: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid cursor responses instead of presenting an empty result', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }))
    await expect(fetchConsoleAudit({ cursor: 'bad' })).rejects.toMatchObject({ status: 400 })
  })

  it('only emits allowlisted filter keys', () => {
    expect(
      auditQueryString({ actorId: 'user1', cursor: 'cursor1', ignored: 'secret' } as never)
    ).toBe('actorId=user1&cursor=cursor1')
  })
})
