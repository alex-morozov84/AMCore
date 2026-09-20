import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'
import { fetchConsoleOverview } from './overview'

vi.mock('@/shared/api/server', () => ({ fetchBackend: vi.fn() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: vi.fn() }))

describe('fetchConsoleOverview', () => {
  it('requests the overview endpoint with the console token resolver', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({
      status: 'success',
      data: { readiness: 'ready', dependencies: [], version: '1.0.0', processRole: 'all' },
    })

    await fetchConsoleOverview()

    expect(fetchBackend).toHaveBeenCalledWith('/api/v1/admin/overview', expect.anything(), {
      auth: 'required',
      tokenResolver: getConsoleAwareAccessToken,
    })
  })
})
