import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOrganizationAccessController } from '../model/access-controller'

import { memberRemovalRejectionCodes, removeMember } from './member-removal-client'
const binding = 'a'.repeat(64)
afterEach(() => vi.unstubAllGlobals())
const run = () => removeMember(binding, 'org', 'user', 'member', new AbortController().signal)
describe('removal transport acknowledgments and refusals', () => {
  it('sends a bodyless fenced DELETE and accepts only the validated200 envelope', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ binding, data: { removed: true } }))
    vi.stubGlobal('fetch', transport)
    await expect(run()).resolves.toEqual({ removed: true })
    expect(transport.mock.calls[0]![0]).toContain('/members/user?expectedMemberId=member')
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: 'DELETE',
      headers: { 'X-AMCore-Context-Session': binding },
    })
    expect(transport.mock.calls[0]![1].body).toBeUndefined()
  })
  it.each([
    [400, 'BUSINESS_RULE_VIOLATION'],
    [404, 'RESOURCE_NOT_FOUND'],
    [409, 'MEMBER_ROLES_CONFLICT'],
    [409, 'MEMBER_API_KEYS_LIMIT'],
    [429, 'RATE_LIMIT_EXCEEDED'],
  ])('preserves confirmed refusal %i/%s', async (status, errorCode) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ errorCode }, { status: Number(status) }))
    )
    await expect(run()).rejects.toMatchObject({ status, body: { errorCode } })
  })
  it.each([
    [503, 'MEMBER_API_KEYS_WRITE_UNAVAILABLE'],
    [503, 'BUSINESS_RULE_VIOLATION'],
    [404, 'BUSINESS_RULE_VIOLATION'],
    [400, 'UNRECOGNIZED'],
  ])('keeps unexpected result %i/%s unknown', async (status, errorCode) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ errorCode }, { status: Number(status) }))
    )
    const controller = createOrganizationAccessController(binding, 'org')
    controller.setAuthority(true)
    controller.setRefresh(async () => 'ready')
    const outcome = await controller.execute('member', run, {
      rejectionCodes: memberRemovalRejectionCodes,
    })
    expect(outcome.status).toBe('unknown')
  })
  it('preserves unknown503 Retry-After through the existing controller', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { errorCode: 'MEMBER_API_KEYS_WRITE_UNAVAILABLE' },
            { status: 503, headers: { 'Retry-After': '60' } }
          )
        )
    )
    const controller = createOrganizationAccessController(binding, 'org')
    controller.setAuthority(true)
    controller.setRefresh(async () => 'ready')
    const started = Date.now()
    const outcome = await controller.execute('member', run, {
      rejectionCodes: memberRemovalRejectionCodes,
    })
    expect(outcome.status).toBe('unknown')
    expect('retryAt' in outcome && outcome.retryAt).toBeGreaterThanOrEqual(started + 60000)
  })
  it.each([
    new Response(null, { status: 204 }),
    Response.json({ binding, data: { removed: false } }),
    Response.json({ binding: 'b'.repeat(64), data: { removed: true } }),
  ])('rejects invalid success', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(run()).rejects.toThrow()
  })
})
