import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/audit-lookup', () => ({ handleConsoleAuditLookup: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleAuditLookup } from '@/shared/api/console/audit-lookup'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { POST } from './route'

describe('POST /api/console/audit/lookup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the host guard before the private lookup handler', async () => {
    const request = new Request('https://product.example.test/api/console/audit/lookup', {
      method: 'POST',
    })
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))
    const response = await POST(request)
    expect(response.status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(handleConsoleAuditLookup).not.toHaveBeenCalled()
  })
})
