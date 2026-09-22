import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/step-up', () => ({ handleConsoleStepUp: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleStepUp } from '@/shared/api/console/step-up'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { POST } from './route'

describe('POST /api/console/auth/step-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the request through the console host guard before step-up', async () => {
    const request = new Request('https://console.example.test/api/console/auth/step-up', {
      method: 'POST',
    })
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(handleConsoleStepUp).not.toHaveBeenCalled()
  })
})
