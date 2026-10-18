import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { server } from '@/test/msw/server'

import { createOrganizationAccessController } from '../model/access-controller'
import { memberKeyRejectionCodes } from '../model/member-api-keys/hooks'

import { memberKeysClient } from './member-api-keys-client'
vi.mock('client-only', () => ({}))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
const binding = 'a'.repeat(64)
const base = '/api/product-access/organizations/org/members/user/api-keys'
const result = {
  organizationId: 'org',
  userId: 'user',
  memberId: 'member',
  requestedCount: 1,
  affectedCount: 1,
}
const signal = () => new AbortController().signal

describe('member key transport and structured outcomes', () => {
  it('all sends only captured member identity and binding, never bearer or page selection', async () => {
    server.use(
      http.post(`${base}/revoke-all`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        expect(request.headers.get('x-amcore-context-session')).toBe(binding)
        expect(await request.json()).toEqual({ expectedMemberId: 'member' })
        return HttpResponse.json({ binding, data: result })
      })
    )
    await expect(
      memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal())
    ).resolves.toEqual(result)
  })
  it.each([
    [404, 'MEMBER_API_KEY_UNAVAILABLE'],
    [409, 'MEMBER_API_KEYS_CONFLICT'],
    [409, 'MEMBER_API_KEYS_LIMIT'],
    [403, 'FORBIDDEN'],
  ] as const)('known %s %s is rejected without replay', async (status, errorCode) => {
    let calls = 0
    server.use(
      http.post(`${base}/revoke-all`, () => {
        calls++
        return HttpResponse.json({ errorCode }, { status })
      })
    )
    const controller = createOrganizationAccessController(binding, 'org')
    controller.setAuthority(true)
    controller.setRefresh(async () => 'ready')
    const outcome = await controller.execute(
      'member',
      (signal) =>
        memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal),
      { timeoutMs: 20000, rejectionCodes: memberKeyRejectionCodes }
    )
    expect(outcome.status).toBe('rejected')
    expect(calls).toBe(1)
  })
  it('5xx remains unknown, and a committed response survives a failed reread', async () => {
    const controller = createOrganizationAccessController(binding, 'org')
    controller.setAuthority(true)
    controller.setRefresh(async () => 'error')
    server.use(http.post(`${base}/revoke-all`, () => HttpResponse.json({ binding, data: result })))
    expect(
      await controller.execute(
        'member',
        (signal) =>
          memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal),
        { rejectionCodes: memberKeyRejectionCodes }
      )
    ).toMatchObject({ status: 'committed', followup: 'error' })
    controller.setAuthority(true)
    server.use(
      http.post(`${base}/revoke-all`, () =>
        HttpResponse.json({ errorCode: 'MEMBER_API_KEYS_WRITE_UNAVAILABLE' }, { status: 503 })
      )
    )
    expect(
      await controller.execute(
        'member',
        (signal) =>
          memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal),
        { rejectionCodes: memberKeyRejectionCodes }
      )
    ).toMatchObject({ status: 'unknown' })
  })
  it('refuses a wrong-session envelope or an alternate successful status', async () => {
    server.use(
      http.post(`${base}/revoke-all`, () =>
        HttpResponse.json({ binding: 'b'.repeat(64), data: result })
      )
    )
    await expect(
      memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal())
    ).rejects.toThrow('CONTEXT_SESSION_CHANGED')
    server.use(
      http.post(`${base}/revoke-all`, () =>
        HttpResponse.json({ binding, data: result }, { status: 201 })
      )
    )
    await expect(
      memberKeysClient.revoke(binding, 'org', 'user', { expectedMemberId: 'member' }, signal())
    ).rejects.toThrow('INVALID_WRITE_ACKNOWLEDGMENT')
  })
})
