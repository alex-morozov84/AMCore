// @vitest-environment node
// Captured from a real API transaction: COMMIT, then test-side acknowledgment loss.
import { memberRolesResponseSchema, replaceMemberRolesResponseSchema } from '@amcore/shared'
import { beforeEach, expect, it, vi } from 'vitest'

import { fetchBackendResponse } from '@/shared/api/backend-transport'
import { executeContextOperation } from '@/shared/api/bff/context-executor'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import captured from '@/shared/api/bff/fixtures/member-ack-lost.json'
import {
  browserTestHeaders,
  FakeVaultStore,
  freshRefresh,
  makeBrowserEntry,
} from '@/shared/api/bff/test-fakes'
import { SimpleLock } from '@/shared/api/bff/test-lock-fakes'

import { membersClient } from '../../api/members-client'

import { createOrganizationAccessController } from './controller'

beforeEach(() =>
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-domain-browser-transport-key-at-least-32>')
)
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/backend-transport', () => ({
  fetchBackendResponse: vi.fn(),
  getBackendBaseUrl: () => 'http://api.test',
}))
vi.mock('client-only', () => ({}))
it('replays actual committed safe503 through BFF/headless: unknown, fresh V+1, no PATCH replay', async () => {
  const entry = makeBrowserEntry()
  const store = new FakeVaultStore()
  store.seed('session-x', entry)
  const binding = contextSessionBinding('session-x', entry)
  const upstream = vi.fn(async (_url: unknown, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? Response.json(captured.body, { status: captured.status })
      : Response.json(captured.snapshot)
  )
  vi.mocked(fetchBackendResponse).mockImplementation((url, _source, init) => upstream(url, init))
  const deps = {
    store,
    lock: new SimpleLock(),
    verifyBinding: async () => undefined,
    upstreamRefresh: vi.fn(freshRefresh),
    readSessionId: async () => 'session-x',
    apiBase: 'http://api.test',
  }
  const operation = {
    path: '/api/v1/organizations/org/members/user/roles',
    organizationId: 'org',
    successStatus: 200,
  }
  const input = { expectedSession: binding, headers: browserTestHeaders() }
  let fresh: unknown
  const controller = createOrganizationAccessController(binding, 'org')
  controller.setAuthority(true)
  controller.setRefresh(async () => 'ready')
  controller.registerRead(async () => {
    fresh = (
      await executeContextOperation(
        { ...operation, method: 'GET', schema: memberRolesResponseSchema },
        input,
        deps
      )
    ).data
  })
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) =>
    contextRoute(
      new Request('http://app.test/api/product-access/organizations/org/members/user/roles', {
        method: 'PATCH',
      }),
      () =>
        executeContextOperation(
          {
            ...operation,
            method: 'PATCH',
            schema: replaceMemberRolesResponseSchema,
            body: JSON.parse(String(init.body)),
          },
          input,
          deps
        )
    )
  )
  try {
    const outcome = await controller.save(captured.snapshot.member.memberId, (signal) =>
      membersClient.save(
        binding,
        'org',
        'user',
        {
          expectedMemberId: captured.snapshot.member.memberId,
          expectedAclVersion: captured.aclBefore,
          roleIds: [],
        },
        signal
      )
    )
    expect(outcome).toMatchObject({
      status: 'unknown',
      error: { status: 503, body: { errorCode: 'MEMBER_ROLES_SAVE_UNAVAILABLE' } },
    })
    expect(fresh).toEqual(captured.snapshot)
    expect(captured.snapshot.aclVersion).toBe(captured.aclBefore + 1)
    expect(captured.snapshot.assignedRoles).toEqual([])
    expect(captured.transportCount).toBe(1)
    expect(captured.auditCount).toBe(1)
    await controller.refresh()
    expect(upstream.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  } finally {
    vi.stubGlobal('fetch', originalFetch)
  }
})
