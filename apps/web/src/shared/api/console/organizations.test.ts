import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'
import { fetchConsoleOrganizations } from './organizations'

vi.mock('@/shared/api/server', () => ({ fetchBackend: vi.fn() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: vi.fn() }))

describe('fetchConsoleOrganizations', () => {
  it('requests the paginated organizations endpoint with the console token resolver', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleOrganizations(2, 10)

    expect(fetchBackend).toHaveBeenCalledWith(
      '/api/v1/admin/organizations?page=2&limit=10',
      expect.anything(),
      { auth: 'required', tokenResolver: getConsoleAwareAccessToken }
    )
  })

  it('defaults to page 1 and the default page size', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { data: [], total: 0, page: 1, limit: 20 },
    })

    await fetchConsoleOrganizations()

    const [path] = vi.mocked(fetchBackend).mock.calls[0]
    expect(path).toBe('/api/v1/admin/organizations?page=1&limit=20')
  })
})
