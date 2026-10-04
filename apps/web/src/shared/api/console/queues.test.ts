import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'
import { fetchConsoleQueues } from './queues'

vi.mock('@/shared/api/server', () => ({ fetchBackend: vi.fn() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: vi.fn() }))

describe('fetchConsoleQueues', () => {
  it('reads the fixed queue summary route with the console token and no caching', async () => {
    vi.mocked(fetchBackend).mockResolvedValue({ status: 'unavailable', reason: 'upstream' })
    await fetchConsoleQueues()
    expect(fetchBackend).toHaveBeenCalledWith(
      '/api/v1/admin/background-work/queues',
      expect.anything(),
      { auth: 'required', cache: 'no-store', tokenResolver: getConsoleAwareAccessToken }
    )
  })
})
