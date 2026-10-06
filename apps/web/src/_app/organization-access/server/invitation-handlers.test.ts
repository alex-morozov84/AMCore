import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOrganizationInvitation,
  readOrganizationInvitations,
  revokeOrganizationInvitation,
} from '@/entities/organization-context/index.server'

import { invitationManagerHandlers } from './invitation-handlers'

vi.mock('server-only', () => ({}))
vi.mock('@/entities/organization-context/index.server', () => ({
  createOrganizationInvitation: vi.fn(),
  readOrganizationInvitations: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  readInvitationManagerOperation: vi.fn(),
  readInvitationRoleChoices: vi.fn(),
  reissueOrganizationInvitation: vi.fn(),
}))
const origin = 'http://localhost:3002'
const operationId = '01900000-0000-7000-8000-000000000000'
function request(method = 'POST', headers: Record<string, string> = {}, body?: string, query = '') {
  return new Request(`http://0.0.0.0:3000/api/product-access/organizations/org/invites${query}`, {
    method,
    headers: { host: 'localhost:3002', 'x-invitation-operation-id': operationId, ...headers },
    body,
  })
}
beforeEach(() => vi.clearAllMocks())

describe('invitation manager dedicated BFF contracts', () => {
  it('requires exact current public Origin, including bodyless DELETE; Referer is insufficient', async () => {
    const invalid: Record<string, string>[] = [
      {},
      { referer: `${origin}/en/organizations/org/invites` },
      { origin: `${origin}/` },
      { origin: 'http://evil.test' },
    ]
    for (const headers of invalid) {
      expect(
        (
          await invitationManagerHandlers.revoke(
            request('DELETE', headers, undefined, '?expectedGeneration=1'),
            'org',
            'invite'
          )
        ).status
      ).toBe(403)
    }
    expect(revokeOrganizationInvitation).not.toHaveBeenCalled()
    vi.mocked(revokeOrganizationInvitation).mockResolvedValue({
      binding: 'a'.repeat(64),
      data: { status: 'revoked' },
    })
    const result = await invitationManagerHandlers.revoke(
      request('DELETE', { origin }, undefined, '?expectedGeneration=1'),
      'org',
      'invite'
    )
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ data: { status: 'revoked' } })
  })

  it('accepts an actually empty Next DELETE stream and rejects every payload byte', async () => {
    vi.mocked(revokeOrganizationInvitation).mockResolvedValue({
      binding: 'a'.repeat(64),
      data: { status: 'revoked' },
    })
    const empty = request('DELETE', { origin }, undefined, '?expectedGeneration=1')
    Object.defineProperty(empty, 'body', {
      value: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    })
    expect((await invitationManagerHandlers.revoke(empty, 'org', 'invite')).status).toBe(200)
    vi.clearAllMocks()
    expect(
      (
        await invitationManagerHandlers.revoke(
          request('DELETE', { origin }, ' ', '?expectedGeneration=1'),
          'org',
          'invite'
        )
      ).status
    ).toBe(400)
    expect(revokeOrganizationInvitation).not.toHaveBeenCalled()
  })

  it('preserves202 and privacy headers without claiming email delivery', async () => {
    vi.mocked(createOrganizationInvitation).mockResolvedValue({
      binding: 'a'.repeat(64),
      data: { status: 'invited' },
    })
    const result = await invitationManagerHandlers.create(
      request(
        'POST',
        { origin, 'content-type': 'application/json' },
        '{"email":"recipient@example.test"}'
      ),
      'org'
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toMatchObject({ data: { status: 'invited' } })
    expect(result.headers.get('cache-control')).toContain('no-store')
    expect(result.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('rejects duplicate query values, unexpected DELETE bodies and mutation queries before domain work', async () => {
    expect(
      (await invitationManagerHandlers.list(request('GET', {}, undefined, '?page=1&page=2'), 'org'))
        .status
    ).toBe(400)
    expect(
      (
        await invitationManagerHandlers.revoke(
          request('DELETE', { origin }, '{}', '?expectedGeneration=1'),
          'org',
          'invite'
        )
      ).status
    ).toBe(400)
    expect(
      (
        await invitationManagerHandlers.create(
          request('POST', { origin, 'content-type': 'application/json' }, '{}', '?unexpected=1'),
          'org'
        )
      ).status
    ).toBe(400)
    expect(readOrganizationInvitations).not.toHaveBeenCalled()
    expect(revokeOrganizationInvitation).not.toHaveBeenCalled()
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })
})
