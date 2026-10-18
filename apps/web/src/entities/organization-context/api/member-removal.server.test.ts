// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { removalFailure } from '@/entities/organization-context/api/member-removal-client'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  assertContextMutationOrigin,
  contextRouteInput,
  contextRouteQuery,
} from '@/shared/api/bff/context-route-input'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { FakeVaultStore, freshRefresh, makeEntry } from '@/shared/api/bff/test-fakes'
import { SimpleLock } from '@/shared/api/bff/test-lock-fakes'
import { ApiRequestError } from '@/shared/api/http-client'

import { removeOrganizationMember } from './member-removal.server'
const route = {
  DELETE: (request: Request, _params: unknown) =>
    contextRoute(request, () => {
      assertContextMutationOrigin(request, true)
      if (request.body !== null) throw new ContextRequestError(400, 'BAD_REQUEST')
      return removeOrganizationMember(
        'org',
        'user',
        contextRouteQuery(request),
        contextRouteInput(request)
      )
    }),
}
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: vi.fn() }))
const base = 'http://localhost:3002/api/product-access/organizations/org/members/user'
const params = { params: Promise.resolve({ id: 'org', userId: 'user' }) }
let binding: string
let upstream: ReturnType<typeof vi.fn>
function request(query = 'expectedMemberId=member', extra: RequestInit = {}) {
  return new Request(`${base}?${query}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3002', 'X-AMCore-Context-Session': binding },
    ...extra,
  })
}
beforeEach(() => {
  const entry = makeEntry()
  const store = new FakeVaultStore()
  store.seed('session', entry)
  binding = contextSessionBinding('session', entry)
  upstream = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.mocked(productContextDeps).mockReturnValue({
    store,
    lock: new SimpleLock(),
    upstreamRefresh: freshRefresh,
    readSessionId: async () => 'session',
    apiBase: 'http://api.test',
    fetch: upstream,
  } as never)
})
describe('bodyless removal API -> DAL -> BFF contract', () => {
  it('adapts only an exact204 and overwrites caller credentials and org selector', async () => {
    const result = await route.DELETE(
      request(undefined, {
        headers: {
          origin: 'http://localhost:3002',
          'X-AMCore-Context-Session': binding,
          authorization: 'Bearer caller-bound-token',
          'x-amcore-organization-id': 'foreign',
        },
      }),
      params
    )
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.json()).toEqual({ binding, data: { removed: true } })
    const [url, options] = upstream.mock.calls[0]!
    expect(url).toContain('/organizations/org/members/user?expectedMemberId=member')
    expect(options.headers.get('authorization')).not.toBe('Bearer caller-bound-token')
    expect(options.headers.get('x-amcore-organization-id')).toBe('org')
    expect(options.body).toBeUndefined()
  })
  it.each([
    '',
    'expectedMemberId=',
    'expectedMemberId=a%2Fb',
    'expectedMemberId=a&expectedMemberId=b',
    'unknown=x',
  ])('rejects invalid query %s before upstream', async (query) => {
    expect((await route.DELETE(request(query), params)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it.each([{}, { origin: 'https://foreign.test' }])(
    'requires strict trusted Origin %j',
    async (headers) => {
      expect(
        (
          await route.DELETE(
            request(undefined, {
              headers: new Headers(headers.origin ? { origin: headers.origin } : {}),
            }),
            params
          )
        ).status
      ).toBe(403)
      expect(upstream).not.toHaveBeenCalled()
    }
  )
  it('rejects body and unsupported methods', async () => {
    expect((await route.DELETE(request(undefined, { body: '{}' }), params)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it.each([
    [400, 'BUSINESS_RULE_VIOLATION'],
    [404, 'RESOURCE_NOT_FOUND'],
    [409, 'MEMBER_ROLES_CONFLICT'],
    [409, 'MEMBER_API_KEYS_LIMIT'],
  ])(
    'preserves real error %i/%s through executor and outcome adapter',
    async (status, errorCode) => {
      upstream.mockResolvedValue(Response.json({ errorCode }, { status: Number(status) }))
      const response = await route.DELETE(request(), params)
      const body = await response.json()
      expect(response.status).toBe(status)
      expect(body.errorCode).toBe(errorCode)
      expect(removalFailure(response.status, body, response.headers)).toBeInstanceOf(
        ApiRequestError
      )
    }
  )
  it('rejects wrong upstream success and session changes before claiming removal', async () => {
    upstream.mockResolvedValue(Response.json({ removed: true }))
    expect((await route.DELETE(request(), params)).status).toBe(502)
    upstream.mockClear()
    expect(
      (
        await route.DELETE(
          request(undefined, {
            headers: {
              origin: 'http://localhost:3002',
              'X-AMCore-Context-Session': 'b'.repeat(64),
            },
          }),
          params
        )
      ).status
    ).toBe(409)
    expect(upstream).not.toHaveBeenCalled()
  })
})
