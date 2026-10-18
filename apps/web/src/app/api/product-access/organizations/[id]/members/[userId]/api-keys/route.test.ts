// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as single from '@/app/api/product-access/organizations/[id]/members/[userId]/api-keys/[keyId]/revoke/route'
import * as all from '@/app/api/product-access/organizations/[id]/members/[userId]/api-keys/revoke-all/route'
import * as inventory from '@/app/api/product-access/organizations/[id]/members/[userId]/api-keys/route'
import { readMemberKeys, revokeMemberKeys } from '@/entities/organization-context/index.server'

vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({
  readMemberKeys: vi.fn(),
  revokeMemberKeys: vi.fn(),
}))
const root = 'http://localhost:3002/api/product-access/organizations/org-a/members/user-a/api-keys'
const params = { params: Promise.resolve({ id: 'org-a', userId: 'user-a', keyId: 'key-a' }) }
const body = JSON.stringify({ expectedMemberId: 'member-a' })
function mutation(overrides: RequestInit = {}) {
  return new Request(`${root}/revoke-all`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3002', 'content-type': 'application/json' },
    body,
    ...overrides,
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readMemberKeys).mockResolvedValue({ binding: 'a'.repeat(64), data: {} } as never)
  vi.mocked(revokeMemberKeys).mockResolvedValue({ binding: 'a'.repeat(64), data: {} } as never)
})
describe('member key BFF admission', () => {
  it('passes exact identities and session binding with private no-store responses', async () => {
    const response = await inventory.GET(
      new Request(`${root}?expectedMemberId=member-a`, {
        headers: { 'X-AMCore-Context-Session': 'a'.repeat(64) },
      }),
      params
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(vi.mocked(readMemberKeys).mock.calls[0]!.slice(0, 3)).toEqual([
      'org-a',
      'user-a',
      { expectedMemberId: 'member-a' },
    ])
    expect(vi.mocked(readMemberKeys).mock.calls[0]![3].expectedSession).toBe('a'.repeat(64))
    await single.POST(mutation(), params)
    expect(vi.mocked(revokeMemberKeys).mock.calls[0]![4]).toBe('key-a')
  })
  it.each([
    ['missing origin', () => mutation({ headers: { 'content-type': 'application/json' } }), 403],
    [
      'foreign origin',
      () =>
        mutation({
          headers: { origin: 'https://foreign.test', 'content-type': 'application/json' },
        }),
      403,
    ],
    [
      'large decoded body',
      () => mutation({ body: JSON.stringify({ expectedMemberId: 'x'.repeat(4096) }) }),
      413,
    ],
    [
      'encoded body',
      () =>
        mutation({
          headers: {
            origin: 'http://localhost:3002',
            'content-type': 'application/json',
            'content-encoding': 'gzip',
          },
        }),
      400,
    ],
  ] as const)('%s fails before forwarding', async (_label, build, status) => {
    expect((await all.POST(build(), params)).status).toBe(status)
    expect(revokeMemberKeys).not.toHaveBeenCalled()
  })
  it('rejects oversized and duplicate queries before forwarding', async () => {
    expect((await inventory.GET(new Request(`${root}?x=${'x'.repeat(2048)}`), params)).status).toBe(
      413
    )
    expect((await inventory.GET(new Request(`${root}?page=1&page=2`), params)).status).toBe(400)
    expect(readMemberKeys).not.toHaveBeenCalled()
  })
  it('advertises only the supported method', () => {
    expect(all.GET().headers.get('allow')).toBe('POST')
    expect(inventory.POST().headers.get('allow')).toBe('GET')
  })
})
