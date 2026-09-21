import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/access-probe', () => ({
  probeConsoleAccess: vi.fn(),
  consoleAccessProbeStatus: (result: { kind: string; status?: number }) =>
    result.kind === 'admitted'
      ? 204
      : result.kind === 'denied'
        ? result.status
        : result.kind === 'upstream-unavailable'
          ? 503
          : 404,
}))
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

  it.each([
    [{ kind: 'admitted' }, 204],
    [{ kind: 'denied', status: 401 }, 401],
    [{ kind: 'denied', status: 403 }, 403],
    [{ kind: 'upstream-unavailable' }, 503],
    [{ kind: 'indeterminate' }, 404],
  ] as const)('adapts probe result to an empty response', async (result, status) => {
    mockedProbe.mockResolvedValue(result)

    const response = await GET(new Request('http://example.test/api/console/access'))

    expect(response.status).toBe(status)
    expect(await response.text()).toBe('')
  })

  it('applies the host guard before probing access', async () => {
    mockedHostGuard.mockResolvedValue(new Response(null, { status: 404 }))

    const response = await GET(new Request('http://example.test/api/console/access'))

    expect(response.status).toBe(404)
    expect(mockedProbe).not.toHaveBeenCalled()
  })
})
