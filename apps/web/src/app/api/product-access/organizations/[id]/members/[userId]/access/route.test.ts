// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as access from '@/app/api/product-access/organizations/[id]/members/[userId]/access/route'
import { readMemberAccess } from '@/entities/organization-context/index.server'

vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({ readMemberAccess: vi.fn() }))

const params = { params: Promise.resolve({ id: 'org-a', userId: 'user-1' }) }
const url = 'http://0.0.0.0:3000/api/product-access/organizations/org-a/members/user-1/access'
const ok = { binding: 'a'.repeat(64), data: { scope: 'organization-membership' } }
beforeEach(() => vi.clearAllMocks())

describe('member access BFF route', () => {
  it('serves the read with a private no-store response and the route identifiers', async () => {
    vi.mocked(readMemberAccess).mockResolvedValue(ok as never)
    const response = await access.GET(new Request(url), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(vi.mocked(readMemberAccess).mock.calls[0]!.slice(0, 2)).toEqual(['org-a', 'user-1'])
  })

  it.each(['HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE'] as const)(
    '%s is an explicit 405 that allows only GET',
    async (method) => {
      const response = await access[method]()
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET')
    }
  )
})
