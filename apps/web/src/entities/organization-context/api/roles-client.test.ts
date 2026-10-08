import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'
import { server } from '@/test/msw/server'

import { rolesClient } from './roles-client'

vi.mock('client-only', () => ({}))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const binding = 'a'.repeat(64)
const signal = () => new AbortController().signal
const base = '/api/product-access/organizations/org'
const detail = {
  role: { id: 'r', name: 'Support', description: null, isSystem: false, organizationId: 'org' },
  aclVersion: 1,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: { total: 0, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
}
const save = { expectedAclVersion: 1, name: 'Support', description: null, presets: [] }

describe('rolesClient writes', () => {
  it('sends the session binding and JSON only, never an Authorization header', async () => {
    let headers: Headers | undefined
    server.use(
      http.post(`${base}/role-definitions`, ({ request }) => {
        headers = request.headers
        return HttpResponse.json({ binding, data: detail }, { status: 201 })
      })
    )
    await rolesClient.create(binding, 'org', { name: 'Support' }, signal())
    expect(headers?.get('x-amcore-context-session')).toBe(binding)
    expect(headers?.get('content-type')).toBe('application/json')
    expect(headers?.get('authorization')).toBeNull()
  })

  it('refuses a success status other than the contract (create 201, save 200) as an invalid acknowledgment', async () => {
    server.use(
      http.post(`${base}/role-definitions`, () => HttpResponse.json({ binding, data: detail })),
      http.patch(`${base}/role-definitions/r`, () =>
        HttpResponse.json({ binding, data: { detail, changed: true } }, { status: 201 })
      )
    )
    await expect(rolesClient.create(binding, 'org', { name: 'Support' }, signal())).rejects.toThrow(
      'INVALID_WRITE_ACKNOWLEDGMENT'
    )
    await expect(rolesClient.save(binding, 'org', 'r', save, signal())).rejects.toThrow(
      'INVALID_WRITE_ACKNOWLEDGMENT'
    )
  })

  it('discards an envelope from another session and surfaces stable error codes with status', async () => {
    server.use(
      http.patch(`${base}/role-definitions/r`, () =>
        HttpResponse.json({ binding: 'b'.repeat(64), data: { detail, changed: true } })
      ),
      http.post(`${base}/role-definitions/r/deletion`, () =>
        HttpResponse.json({ errorCode: 'ROLE_DELETE_IMPACT_CHANGED' }, { status: 409 })
      )
    )
    await expect(rolesClient.save(binding, 'org', 'r', save, signal())).rejects.toThrow(
      'CONTEXT_SESSION_CHANGED'
    )
    const error = await rolesClient
      .remove(
        binding,
        'org',
        'r',
        { expectedAclVersion: 1, expectedLiveInvitationCount: 0 },
        signal()
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 409 })
  })

  it('validates a command locally before any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(() => rolesClient.create(binding, 'org', { name: 'x' }, signal())).toThrow()
    expect(() =>
      rolesClient.save(binding, 'org', 'r', { ...save, extra: true } as never, signal())
    ).toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('encodes identifiers in the path', async () => {
    let path = ''
    server.use(
      http.get(`${base}/role-definitions/:roleId`, ({ request }) => {
        path = new URL(request.url).pathname
        return HttpResponse.json({ binding, data: detail })
      })
    )
    await rolesClient.detail(binding, 'org', 'role id/1', signal())
    expect(path).toBe(`${base}/role-definitions/role%20id%2F1`)
  })
})
