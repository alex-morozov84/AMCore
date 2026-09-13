import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/logout-handler', () => ({ handleConsoleLogout: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleLogout } from '@/shared/api/console/logout-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { POST } from './route'

describe('POST /api/console/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the request through the console host guard before logout', async () => {
    const request = new Request('https://console.example.test/api/console/auth/logout', {
      method: 'POST',
    })
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(handleConsoleLogout).not.toHaveBeenCalled()
  })
})
