import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/auth-handler', () => ({ handleConsoleLogin: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleLogin } from '@/shared/api/console/auth-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { POST } from './route'

describe('POST /api/console/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the request through the console host guard before login', async () => {
    const request = new Request('https://console.example.test/api/console/auth/login', {
      method: 'POST',
    })
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(handleConsoleLogin).not.toHaveBeenCalled()
  })
})
