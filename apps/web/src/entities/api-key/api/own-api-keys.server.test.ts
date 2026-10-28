// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchBackendResponse } from '@/shared/api/backend-transport'
import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import {
  browserTestHeaders,
  FakeVaultStore,
  freshRefresh,
  makeBrowserEntry,
} from '@/shared/api/bff/test-fakes'
import { SimpleLock } from '@/shared/api/bff/test-lock-fakes'

import {
  createOwnApiKey,
  readOwnApiKeyAdmission,
  readOwnApiKeys,
  revokeOwnApiKey,
  verifyOwnApiKeySession,
} from './own-api-keys.server'

beforeEach(() =>
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-domain-browser-transport-key-at-least-32>')
)
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/backend-transport', () => ({
  fetchBackendResponse: vi.fn(),
  getBackendBaseUrl: () => 'http://api.test',
}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: vi.fn() }))
const inputBody = {
  name: 'Export',
  organizationId: 'cmp00000000000000000000000',
  scopes: ['read:Organization'],
}
const created = {
  ...inputBody,
  id: 'key-a',
  key: '<fake-secret>',
  expiresAt: null,
  createdAt: '2026-10-19T00:00:00.000Z',
}
function setup(response: () => Response) {
  const entry = makeBrowserEntry({
    userSnapshot: { id: 'actor', email: 'a@example.test' } as never,
  })
  const store = new FakeVaultStore()
  store.seed('session-a', entry)
  const fetch = vi.fn(async () => response())
  const deps: ContextExecutorDeps & { fetch: typeof globalThis.fetch } = {
    store,
    lock: new SimpleLock(),
    verifyBinding: async () => undefined,
    upstreamRefresh: vi.fn(freshRefresh),
    readSessionId: vi.fn().mockResolvedValue('session-a'),
    apiBase: 'http://api.test',
    fetch,
  }
  vi.mocked(fetchBackendResponse).mockImplementation((url, _source, init) => deps.fetch(url, init))
  vi.mocked(productContextDeps).mockReturnValue(deps)
  const input = {
    expectedSession: contextSessionBinding('session-a', entry),
    headers: browserTestHeaders(),
  }
  return { input, fetch, deps, entry }
}
beforeEach(() => vi.clearAllMocks())
describe('dedicated owner server operations', () => {
  it('creates as the session actor without a TeamAccess/org-context dependency', async () => {
    const { input, fetch } = setup(() => Response.json(created, { status: 201 }))
    const result = await createOwnApiKey(inputBody, input)
    expect(result).toEqual({ binding: input.expectedSession, data: created })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://api.test/api/v1/api-keys')
    expect((init.headers as Headers).has('x-amcore-organization-id')).toBe(false)
    expect(JSON.parse(init.body as string)).not.toHaveProperty('userId')
  })
  it('reads owner-wide inventory and accepts nullable names', async () => {
    const data = { data: [], page: 1, limit: 20, total: 0 }
    const { input, fetch } = setup(() => Response.json(data))
    await expect(readOwnApiKeys({}, input)).resolves.toMatchObject({ data })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('requires an exact empty upstream 204 for revocation', async () => {
    const { input } = setup(() => new Response(null, { status: 204 }))
    await expect(revokeOwnApiKey('key-a', input)).resolves.toMatchObject({
      data: { revoked: true },
    })
    setup(() => Response.json({ revoked: true }))
    await expect(revokeOwnApiKey('key-a', input)).rejects.toMatchObject({ status: 502 })
  })
  it('checks the live cookie binding before dispatch, including another login of the same actor', async () => {
    const { input, deps, fetch, entry } = setup(() => Response.json(created, { status: 201 }))
    ;(deps.store as FakeVaultStore).seed('session-b', entry)
    vi.mocked(deps.readSessionId).mockResolvedValue('session-b')
    await expect(createOwnApiKey(inputBody, input)).rejects.toMatchObject({ status: 409 })
    await expect(verifyOwnApiKeySession(input)).rejects.toMatchObject({ status: 409 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('admission and probes use only the vault and refresh, never a Nest endpoint', async () => {
    const { input, fetch } = setup(() => Response.json({}))
    await expect(readOwnApiKeyAdmission(input.headers)).resolves.toEqual({
      actorId: 'actor',
      binding: input.expectedSession,
    })
    await expect(verifyOwnApiKeySession(input)).resolves.toEqual({
      binding: input.expectedSession,
      data: { verified: true },
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects extra request/response fields and malformed IDs without retaining response text', async () => {
    const { input, fetch } = setup(() =>
      Response.json({ ...created, extra: '<fake-secret>' }, { status: 201 })
    )
    await expect(createOwnApiKey({ ...inputBody, userId: 'other' }, input)).rejects.toMatchObject({
      status: 400,
    })
    expect(fetch).not.toHaveBeenCalled()
    await expect(createOwnApiKey(inputBody, input)).rejects.toMatchObject({
      status: 502,
      message: expect.not.stringContaining('<fake-secret>'),
    })
    await expect(revokeOwnApiKey('../session', input)).rejects.toMatchObject({ status: 400 })
  })
})
