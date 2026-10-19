// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { removeOrganizationMember } from '@/entities/organization-context/index.server'

import * as route from './route'
vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({
  removeOrganizationMember: vi.fn(),
}))
const root = 'http://localhost:3002/api/product-access/organizations/org/members/user'
const params = { params: Promise.resolve({ id: 'org', userId: 'user' }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(removeOrganizationMember).mockResolvedValue({
    binding: 'a'.repeat(64),
    data: { removed: true },
  })
})
describe('member removal route admission', () => {
  it('passes route identity and query to the typed DAL', async () => {
    const response = await route.DELETE(
      new Request(`${root}?expectedMemberId=member`, {
        method: 'DELETE',
        headers: { origin: 'http://localhost:3002' },
      }),
      params
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(removeOrganizationMember).mock.calls[0]!.slice(0, 3)).toEqual([
      'org',
      'user',
      { expectedMemberId: 'member' },
    ])
  })
  it.each(['missing-origin', 'foreign-origin', 'duplicate', 'body', 'encoded'] as const)(
    'rejects %s before DAL',
    async (mode) => {
      const headers: Record<string, string> =
        mode === 'missing-origin'
          ? {}
          : { origin: mode === 'foreign-origin' ? 'https://foreign.test' : 'http://localhost:3002' }
      if (mode === 'encoded') headers['content-encoding'] = 'gzip'
      const url =
        mode === 'duplicate'
          ? `${root}?expectedMemberId=a&expectedMemberId=b`
          : `${root}?expectedMemberId=member`
      const response = await route.DELETE(
        new Request(url, { method: 'DELETE', headers, ...(mode === 'body' ? { body: '{}' } : {}) }),
        params
      )
      expect(response.status).toBe(mode.includes('origin') ? 403 : 400)
      expect(removeOrganizationMember).not.toHaveBeenCalled()
    }
  )
  it('accepts an empty transport stream without treating it as payload', async () => {
    const request = new Request(`${root}?expectedMemberId=member`, {
      method: 'DELETE',
      headers: { origin: 'http://localhost:3002' },
      body: '',
    })
    expect(request.body).not.toBeNull()
    expect((await route.DELETE(request, params)).status).toBe(200)
    expect(removeOrganizationMember).toHaveBeenCalledOnce()
  })
  it('closes unsupported methods', () => {
    for (const handler of [
      route.GET,
      route.POST,
      route.PATCH,
      route.PUT,
      route.HEAD,
      route.OPTIONS,
    ])
      expect(handler().status).toBe(405)
  })
})
