// @vitest-environment node
import {
  ACCESS_API_RESPONSE_BYTES,
  ACCESS_RESPONSE_BYTES,
  ROLE_DETAIL_API_RESPONSE_BYTES,
  ROLE_LIST_API_RESPONSE_BYTES,
  serializedJsonBytes,
} from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from '@/shared/api/bff/context-errors'
import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { FakeVaultStore, freshRefresh, makeEntry } from '@/shared/api/bff/test-fakes'
import { SimpleLock } from '@/shared/api/bff/test-lock-fakes'

import {
  createRoleDefinition,
  deleteRoleDefinition,
  listRoleDefinitions,
  readCapabilityCatalogue,
  readMemberAccess,
  readRoleDefinition,
  saveRoleDefinition,
} from './roles.server'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: vi.fn() }))

const meta = {
  id: 'role-1',
  name: 'Support',
  description: null,
  isSystem: false,
  organizationId: 'org-a',
}
const detail = (pad = 0) => ({
  role: meta,
  aclVersion: 3,
  editMode: 'editable' as const,
  selfHeld: false,
  grantsFullControl: false,
  ruleCount: 0,
  managedPresets: [],
  advancedRules: [],
  holders: {
    total: 1,
    sample: [{ memberId: 'm1', userId: 'u1', name: 'n'.repeat(pad), email: 'u1@example.test' }],
    truncated: false,
  },
  impact: { liveInvitationCount: 0 },
})
/** Detail whose serialized size is exactly `bytes` (padding goes into a holder name). */
function detailOfSize(bytes: number) {
  const base = serializedJsonBytes(detail())
  const value = detail(bytes - base)
  expect(serializedJsonBytes(value)).toBe(bytes)
  return value
}
function setup(respond: () => Response) {
  const entry = makeEntry({ userSnapshot: { id: 'actor', email: 'a@example.test' } as never })
  const store = new FakeVaultStore()
  store.seed('session-x', entry)
  const fetch = vi.fn(async () => respond())
  const deps: ContextExecutorDeps = {
    store,
    lock: new SimpleLock(),
    upstreamRefresh: vi.fn(freshRefresh),
    readSessionId: vi.fn().mockResolvedValue('session-x'),
    apiBase: 'http://api.test',
    fetch,
  }
  vi.mocked(productContextDeps).mockReturnValue(deps)
  const input = {
    expectedSession: contextSessionBinding('session-x', entry),
    headers: new Headers({ authorization: 'Bearer browser-token', cookie: 'x=1' }),
  }
  return { fetch, input }
}
const call = (fetch: ReturnType<typeof setup>['fetch']) => {
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  return { url: new URL(url), init, headers: init.headers as Headers }
}
const access = (pad = 0, glyph = 'n') => ({
  member: { memberId: 'm1', userId: 'u1', name: glyph.repeat(pad), email: 'u1@example.test' },
  aclVersion: 4,
  scope: 'organization-membership' as const,
  roles: { total: 0, items: [], truncated: false },
  unsafeLinkCount: 0,
  items: [],
  widening: {
    status: 'computed' as const,
    scope: 'exactItems' as const,
    excludedItems: 0,
    breadth: false,
    synergy: false,
    vetoed: false,
  },
  uncovered: { ruleCount: 0, roleSample: [] },
  qualifiers: [],
})
/** An answer of exactly this many UTF-8 bytes, padded with the given glyph and finished with ASCII. */
function accessOfSize(bytes: number, glyph = 'n') {
  const width = Buffer.byteLength(glyph)
  const base = serializedJsonBytes(access())
  const count = Math.floor((bytes - base) / width)
  const value = access(count, glyph)
  value.member.name += 'n'.repeat(bytes - serializedJsonBytes(value))
  expect(serializedJsonBytes(value)).toBe(bytes)
  return value
}
beforeEach(() => vi.clearAllMocks())

describe('role-definition server operations', () => {
  it('read operations use fixed GET paths and never forward browser credentials', async () => {
    const { fetch, input } = setup(() => Response.json(detail()))
    await readRoleDefinition('org-a', 'role-1', input)
    const sent = call(fetch)
    expect(sent.url.pathname).toBe('/api/v1/organizations/org-a/role-definitions/role-1')
    expect(sent.init.method).toBe('GET')
    expect(sent.headers.get('x-amcore-organization-id')).toBe('org-a')
    expect(sent.headers.get('authorization')).not.toBe('Bearer browser-token')
    expect(sent.headers.get('cookie')).toBeNull()
  })

  it('list sends only validated query parameters', async () => {
    const { fetch, input } = setup(() =>
      Response.json({ data: [], total: 0, page: 2, limit: 20, aclVersion: 1 })
    )
    await listRoleDefinitions('org-a', { page: '2', limit: '20', search: 'ops' }, input)
    const { url } = call(fetch)
    expect(url.pathname).toBe('/api/v1/organizations/org-a/role-definitions')
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'page', 'search'])
    await expect(
      listRoleDefinitions('org-a', { page: '1', extra: '1' }, input)
    ).rejects.toMatchObject({
      status: 400,
    })
  })

  it('create requires an exact 201 and save/delete an exact 200', async () => {
    const created = setup(() => Response.json(detail(), { status: 200 }))
    await expect(
      createRoleDefinition('org-a', { name: 'Support' }, created.input)
    ).rejects.toMatchObject({
      status: 502,
      errorCode: 'INVALID_UPSTREAM_RESPONSE',
    })
    const ok = setup(() => Response.json(detail(), { status: 201 }))
    await expect(
      createRoleDefinition('org-a', { name: 'Support' }, ok.input)
    ).resolves.toMatchObject({
      data: { role: { id: 'role-1' } },
    })
    expect(call(ok.fetch).init.method).toBe('POST')
    const saved = setup(() => Response.json({ detail: detail(), changed: false }))
    const body = { expectedAclVersion: 3, name: 'Support', description: null, presets: [] }
    await saveRoleDefinition('org-a', 'role-1', body, saved.input)
    expect(call(saved.fetch).init.method).toBe('PATCH')
    const removed = setup(() =>
      Response.json({
        roleId: 'role-1',
        aclVersion: 4,
        removedHolderCount: 0,
        affectedInvitationCount: 0,
      })
    )
    await deleteRoleDefinition(
      'org-a',
      'role-1',
      { expectedAclVersion: 3, expectedLiveInvitationCount: 0 },
      removed.input
    )
    expect(call(removed.fetch).url.pathname).toBe(
      '/api/v1/organizations/org-a/role-definitions/role-1/deletion'
    )
  })

  it('rejects malformed ids, unknown body fields and invalid commands before any request', async () => {
    const { fetch, input } = setup(() => Response.json(detail()))
    for (const run of [
      () => readRoleDefinition('org-a', '../x', input),
      () => readRoleDefinition('a/b', 'role-1', input),
      () => createRoleDefinition('org-a', { name: 'Ok', extra: true }, input),
      () => saveRoleDefinition('org-a', 'role-1', { name: 'x' }, input),
      () => deleteRoleDefinition('org-a', 'role-1', { expectedAclVersion: -1 }, input),
      () => readCapabilityCatalogue('bad id', input),
    ])
      await expect(run()).rejects.toBeInstanceOf(ContextRequestError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('propagates the stable API error code and Retry-After from a rejected command', async () => {
    const { input } = setup(() =>
      Response.json({ errorCode: 'ROLE_DEFINITION_CONFLICT' }, { status: 409 })
    )
    const body = { expectedAclVersion: 3, name: 'Support', description: null, presets: [] }
    await expect(saveRoleDefinition('org-a', 'role-1', body, input)).rejects.toMatchObject({
      status: 409,
      errorCode: 'ROLE_DEFINITION_CONFLICT',
    })
  })

  it('an API detail response at its own cap still fits the BFF envelope; a larger one is refused', async () => {
    const atCap = setup(() => Response.json(detailOfSize(ROLE_DETAIL_API_RESPONSE_BYTES)))
    const result = await readRoleDefinition('org-a', 'role-1', atCap.input)
    expect(result.binding).toHaveLength(64)
    const over = setup(() => Response.json(detailOfSize(ROLE_DETAIL_API_RESPONSE_BYTES + 1100)))
    await expect(readRoleDefinition('org-a', 'role-1', over.input)).rejects.toMatchObject({
      status: 502,
    })
  })

  it('an API list response at its own cap fits the BFF envelope', async () => {
    const list = (pad: number) => ({
      data: [
        {
          ...meta,
          name: 'n'.repeat(pad),
          holderCount: 0,
          ruleCount: 0,
          grantsFullControl: false,
          advancedState: 'none' as const,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      aclVersion: 1,
    })
    const base = serializedJsonBytes(list(0))
    const value = list(ROLE_LIST_API_RESPONSE_BYTES - base)
    expect(serializedJsonBytes(value)).toBe(ROLE_LIST_API_RESPONSE_BYTES)
    const { input } = setup(() => Response.json(value))
    await expect(listRoleDefinitions('org-a', {}, input)).resolves.toMatchObject({
      data: { total: 1 },
    })
  })
})

describe('member access read', () => {
  it('uses one fixed GET path, validates both ids and forwards no browser credentials', async () => {
    const { fetch, input } = setup(() => Response.json(access()))
    await readMemberAccess('org-a', 'user-1', input)
    const sent = call(fetch)
    expect(sent.url.pathname).toBe('/api/v1/organizations/org-a/members/user-1/access')
    expect(sent.init.method).toBe('GET')
    expect(sent.headers.get('authorization')).not.toBe('Bearer browser-token')
    expect(sent.headers.get('cookie')).toBeNull()
    await expect(readMemberAccess('org-a', '../x', input)).rejects.toMatchObject({ status: 400 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fits the envelope at the API cap and rejects what the BFF cannot hold', async () => {
    const fits = setup(() => Response.json(accessOfSize(ACCESS_API_RESPONSE_BYTES)))
    await expect(readMemberAccess('org-a', 'user-1', fits.input)).resolves.toMatchObject({
      data: { scope: 'organization-membership' },
    })
    const over = setup(() => Response.json(accessOfSize(ACCESS_RESPONSE_BYTES + 1)))
    await expect(readMemberAccess('org-a', 'user-1', over.input)).rejects.toBeInstanceOf(
      ContextRequestError
    )
  })

  it.each([
    ['ascii', 'n'],
    ['two-byte', 'é'],
    ['four-byte', '😀'],
  ])('holds the same boundaries with %s text', async (_name, glyph) => {
    for (const size of [ACCESS_API_RESPONSE_BYTES - 1, ACCESS_API_RESPONSE_BYTES]) {
      const { input } = setup(() => Response.json(accessOfSize(size, glyph)))
      await expect(readMemberAccess('org-a', 'user-1', input)).resolves.toBeDefined()
    }
    const over = setup(() => Response.json(accessOfSize(ACCESS_RESPONSE_BYTES + 1, glyph)))
    await expect(readMemberAccess('org-a', 'user-1', over.input)).rejects.toBeInstanceOf(
      ContextRequestError
    )
  })

  it('rejects an upstream answer that does not match the contract', async () => {
    const { input } = setup(() => Response.json({ ...access(), scope: 'elsewhere' }))
    await expect(readMemberAccess('org-a', 'user-1', input)).rejects.toMatchObject({ status: 502 })
  })
})
