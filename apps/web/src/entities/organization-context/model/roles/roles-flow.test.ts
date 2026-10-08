// @vitest-environment node
// Client -> BFF route -> typed executor -> fake API, with the real controller and write semantics.
import type { SaveRoleDefinition } from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { roleRouteBody, roleRouteInput } from '@/shared/api/bff/role-route'
import { FakeVaultStore, freshRefresh, makeEntry } from '@/shared/api/bff/test-fakes'
import { SimpleLock } from '@/shared/api/bff/test-lock-fakes'

import {
  createRoleDefinition,
  deleteRoleDefinition,
  saveRoleDefinition,
} from '../../api/roles.server'
import { rolesClient } from '../../api/roles-client'
import { createOrganizationAccessController } from '../access-controller'

import { ROLE_REJECTION_CODES } from './outcomes'

vi.mock('server-only', () => ({}))
vi.mock('client-only', () => ({}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: vi.fn() }))

const meta = {
  id: 'role-1',
  name: 'Support',
  description: null,
  isSystem: false,
  organizationId: 'org',
}
const detail = {
  role: meta,
  aclVersion: 4,
  editMode: 'editable',
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: { total: 0, sample: [], truncated: false },
  impact: { liveInvitationCount: 0 },
}
const dto: SaveRoleDefinition = {
  expectedAclVersion: 3,
  name: 'Support',
  description: null,
  presets: [],
}
const originalFetch = globalThis.fetch

function harness(upstream: (url: string, init?: RequestInit) => Response) {
  const entry = makeEntry({ userSnapshot: { id: 'actor', email: 'a@example.test' } as never })
  const store = new FakeVaultStore()
  store.seed('session-x', entry)
  const binding = contextSessionBinding('session-x', entry)
  const calls: { method: string; url: string }[] = []
  const deps: ContextExecutorDeps = {
    store,
    lock: new SimpleLock(),
    upstreamRefresh: vi.fn(freshRefresh),
    readSessionId: async () => 'session-x',
    apiBase: 'http://api.test',
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url })
      return upstream(url, init)
    }) as typeof fetch,
  }
  vi.mocked(productContextDeps).mockReturnValue(deps)
  // The browser's relative `/api/...` call is served by the real route handlers, with a trusted Origin.
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const url = `http://0.0.0.0:3000${path}`
    const request = new Request(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        origin: 'http://localhost:3002',
        host: 'localhost:3002',
      },
    })
    // The same composition as the thin route files: strict body, code-owned operation, status mapping.
    const input = roleRouteInput(request)
    if (path.endsWith('/deletion'))
      return contextRoute(request, async () =>
        deleteRoleDefinition('org', 'role-1', await roleRouteBody(request), input)
      )
    if (init.method === 'POST')
      return contextRoute(
        request,
        async () => createRoleDefinition('org', await roleRouteBody(request), input),
        201
      )
    return contextRoute(request, async () =>
      saveRoleDefinition('org', 'role-1', await roleRouteBody(request), input)
    )
  })
  const controller = createOrganizationAccessController(binding, 'org')
  controller.setAuthority(true)
  const refresh = vi.fn(async () => 'ready' as const)
  controller.setRefresh(refresh)
  return { controller, binding, calls, refresh }
}
const OPERATION = { rejectionCodes: ROLE_REJECTION_CODES }

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.stubGlobal('fetch', originalFetch))

describe('role commands through the whole transport', () => {
  it('create is acknowledged only by 201; save and delete by 200; each follows with an authority refresh', async () => {
    const { controller, binding, calls, refresh } = harness((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/deletion'))
        return Response.json({
          roleId: 'role-1',
          aclVersion: 5,
          removedHolderCount: 0,
          affectedInvitationCount: 0,
        })
      if (init?.method === 'POST') return Response.json(detail, { status: 201 })
      return Response.json({ detail, changed: true })
    })
    const created = await controller.execute(
      'roles:create',
      (s) => rolesClient.create(binding, 'org', { name: 'Support' }, s),
      OPERATION
    )
    expect(created).toMatchObject({ status: 'committed', followup: 'ready' })
    const saved = await controller.execute(
      'roles:role-1',
      (s) => rolesClient.save(binding, 'org', 'role-1', dto, s),
      OPERATION
    )
    expect(saved).toMatchObject({ status: 'committed', result: { changed: true } })
    const removed = await controller.execute(
      'roles:role-1',
      (s) =>
        rolesClient.remove(
          binding,
          'org',
          'role-1',
          { expectedAclVersion: 4, expectedLiveInvitationCount: 0 },
          s
        ),
      OPERATION
    )
    expect(removed).toMatchObject({ status: 'committed', result: { aclVersion: 5 } })
    expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH', 'POST'])
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('a lost acknowledgment (committed write answered 503) is UNKNOWN, never replayed, and the fresh read is available', async () => {
    let writes = 0
    const { controller, binding, calls } = harness((_url, init) => {
      if (init?.method === 'PATCH') {
        writes += 1
        return Response.json({ errorCode: 'ROLE_SAVE_UNAVAILABLE' }, { status: 503 })
      }
      return Response.json(detail)
    })
    const outcome = await controller.execute(
      'roles:role-1',
      (s) => rolesClient.save(binding, 'org', 'role-1', dto, s),
      OPERATION
    )
    expect(outcome).toMatchObject({ status: 'unknown' })
    expect(writes).toBe(1)
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
    expect(controller.isBusy('roles:role-1')).toBe(false)
  })

  it('stable 4xx command answers are REJECTED with their code; a wrong success status is UNKNOWN', async () => {
    const conflict = harness(() =>
      Response.json({ errorCode: 'ROLE_DEFINITION_CONFLICT' }, { status: 409 })
    )
    const rejected = await conflict.controller.execute(
      'roles:role-1',
      (s) => rolesClient.save(conflict.binding, 'org', 'role-1', dto, s),
      OPERATION
    )
    expect(rejected).toMatchObject({ status: 'rejected', error: { status: 409 } })
    // Upstream answers create with 200 instead of 201: the BFF refuses the acknowledgment.
    const wrong = harness(() => Response.json(detail, { status: 200 }))
    const unknown = await wrong.controller.execute(
      'roles:create',
      (s) => rolesClient.create(wrong.binding, 'org', { name: 'Support' }, s),
      OPERATION
    )
    expect(unknown).toMatchObject({ status: 'unknown' })
  })

  it('a second command for the same role while one is in flight is BUSY and sends nothing', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { controller, binding, calls } = harness(() => Response.json({ detail, changed: true }))
    const first = controller.execute(
      'roles:role-1',
      async (s) => {
        await gate
        return rolesClient.save(binding, 'org', 'role-1', dto, s)
      },
      OPERATION
    )
    const second = await controller.execute(
      'roles:role-1',
      (s) => rolesClient.save(binding, 'org', 'role-1', dto, s),
      OPERATION
    )
    expect(second).toEqual({ status: 'busy' })
    release()
    expect(await first).toMatchObject({ status: 'committed' })
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })

  it('a result for another session or after the target changed is discarded as retired', async () => {
    const { controller, binding } = harness(() => Response.json({ detail, changed: true }))
    const pending = controller.execute(
      'roles:role-1',
      (s) => rolesClient.save(binding, 'org', 'role-1', dto, s),
      OPERATION
    )
    controller.setTarget('other-org')
    expect(await pending).toEqual({ status: 'retired' })
    // The envelope binding must equal the caller's session binding.
    await expect(
      rolesClient.save('b'.repeat(64), 'org', 'role-1', dto, new AbortController().signal)
    ).rejects.toThrow()
  })
})
