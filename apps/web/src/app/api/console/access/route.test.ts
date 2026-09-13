import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/access-probe', () => ({ probeConsoleAccess: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { probeConsoleAccess } from '@/shared/api/console/access-probe'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { GET } from './route'

const mockedProbe = vi.mocked(probeConsoleAccess)
const mockedHostGuard = vi.mocked(withConsoleHostGuard)

describe('GET /api/console/access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedHostGuard.mockImplementation(async (_, handler) => handler())
  })

  it.each([204, 401, 403, 503] as const)(
    'adapts probe status %i to an empty response',
    async (status) => {
      mockedProbe.mockResolvedValue(status)

      const response = await GET(new Request('http://example.test/api/console/access'))

      expect(response.status).toBe(status)
      expect(await response.text()).toBe('')
    }
  )

  it('applies the host guard before probing access', async () => {
    mockedHostGuard.mockResolvedValue(new Response(null, { status: 404 }))

    const response = await GET(new Request('http://example.test/api/console/access'))

    expect(response.status).toBe(404)
    expect(mockedProbe).not.toHaveBeenCalled()
  })
})
