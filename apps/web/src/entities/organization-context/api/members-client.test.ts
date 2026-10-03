import { describe, expect, it, vi } from 'vitest'

import type * as HttpClient from '@/shared/api/http-client'
import { apiClient } from '@/shared/api/http-client'

import { membersClient } from './members-client'

vi.mock('@/shared/api/http-client', async (original) => ({
  ...(await original<typeof HttpClient>()),
  apiClient: { get: vi.fn() },
}))
describe('member role query projection', () => {
  it('does not leak editor target fields into strict query parameters', async () => {
    const binding = 'a'.repeat(64)
    vi.mocked(apiClient.get).mockResolvedValue({
      binding,
      data: {
        member: { memberId: 'm', user: { id: 'u', name: null, email: 'u@example.test' } },
        aclVersion: 1,
        assignedRoleCount: 0,
        assignedRoles: [],
        editMode: 'editable',
        choices: { data: [], page: 1, limit: 20, total: 0 },
      },
    })
    const input = { userId: 'u', search: '', section: 'available' as const, page: 1 }
    await membersClient.roles(binding, 'org', 'u', input, new AbortController().signal)
    const url = new URL(String(vi.mocked(apiClient.get).mock.calls[0]![0]), 'http://local.test')
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'page', 'search', 'section'])
  })
})
