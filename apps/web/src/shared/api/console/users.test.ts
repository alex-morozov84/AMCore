import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'
import { fetchConsoleUsers } from './users'

vi.mock('@/shared/api/server', () => ({ fetchBackend: vi.fn() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: vi.fn() }))

describe('fetchConsoleUsers', () => {
  it('uses the paginated admin users endpoint with the console token resolver', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleUsers({ page: 2, limit: 10 })

    expect(fetchBackend).toHaveBeenCalledWith(
      '/api/v1/admin/users?page=2&limit=10',
      expect.anything(),
      { auth: 'required', tokenResolver: getConsoleAwareAccessToken }
    )
  })

  it('defaults to the shared pagination contract with no discovery params', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleUsers()

    expect(vi.mocked(fetchBackend).mock.calls[0]![0]).toBe('/api/v1/admin/users?page=1&limit=20')
  })

  it('forwards search/sortBy/sortOrder when present', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleUsers({ search: 'alice', sortBy: 'name', sortOrder: 'desc' })

    expect(vi.mocked(fetchBackend).mock.calls[0]![0]).toBe(
      '/api/v1/admin/users?page=1&limit=20&search=alice&sortBy=name&sortOrder=desc'
    )
  })

  it('omits search/sortBy/sortOrder from the query string when absent', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleUsers({ page: 1, limit: 20 })

    const url = vi.mocked(fetchBackend).mock.calls[0]![0] as string
    expect(url).not.toContain('search')
    expect(url).not.toContain('sortBy')
    expect(url).not.toContain('sortOrder')
  })
})
