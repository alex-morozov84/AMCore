import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console/users-role', () => ({ handleConsoleUserRoleUpdate: vi.fn() }))
vi.mock('@/shared/lib/console-host-guard', () => ({ withConsoleHostGuard: vi.fn() }))

import { handleConsoleUserRoleUpdate } from '@/shared/api/console/users-role'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

import { PATCH } from './route'

describe('PATCH /api/console/users/[id]/role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the console host guard before resolving params or changing a role', async () => {
    const request = new Request('https://console.example.test/api/console/users/u1/role', {
      method: 'PATCH',
    })
    const then = vi.fn()
    const context = { params: { then } as unknown as Promise<{ id: string }> }
    vi.mocked(withConsoleHostGuard).mockResolvedValue(new Response(null, { status: 404 }))

    const response = await PATCH(request, context)

    expect(response.status).toBe(404)
    expect(withConsoleHostGuard).toHaveBeenCalledWith(request, expect.any(Function))
    expect(then).not.toHaveBeenCalled()
    expect(handleConsoleUserRoleUpdate).not.toHaveBeenCalled()
  })
})
