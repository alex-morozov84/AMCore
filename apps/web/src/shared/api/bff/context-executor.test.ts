// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { type ContextExecutorDeps, executeContextOperation } from './context-executor'
import { contextSessionBinding } from './context-session'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes'
import { SimpleLock } from './test-lock-fakes'

vi.mock('server-only', () => ({}))

function fixture(stale = false) {
  const entry = makeEntry({
    userSnapshot: { id: 'actor-x', email: 'x@example.test' } as never,
    ...(stale && { accessTokenExpiresAt: Date.now() - 1000 }),
  })
  const store = new FakeVaultStore()
  store.seed('session-x', entry)
  const deps: ContextExecutorDeps = {
    store,
    lock: new SimpleLock(),
    upstreamRefresh: vi.fn(freshRefresh),
    readSessionId: vi.fn().mockResolvedValue('session-x'),
    apiBase: 'http://api.test',
    fetch: vi.fn().mockResolvedValue(Response.json({ name: 'Renamed' })),
  }
  const get = vi.spyOn(store, 'get')
  return { deps, entry, get, expected: contextSessionBinding('session-x', entry) }
}

const operation = {
  method: 'PATCH' as const,
  path: '/api/v1/context-rehearsal/workspaces/org-a',
  organizationId: 'org-a',
  body: { name: 'Renamed' },
  schema: z.strictObject({ name: z.string() }),
}

describe('typed context executor', () => {
  it('preserves exact202 invitation acknowledgment with code-owned operation proof', async () => {
    const { deps, expected } = fixture()
    const operationId = '01900000-0000-7000-8000-000000000000'
    deps.fetch = vi.fn().mockResolvedValue(Response.json({ status: 'invited' }, { status: 202 }))
    const result = await executeContextOperation(
      {
        method: 'POST',
        path: '/api/v1/organizations/org-a/invites',
        organizationId: 'org-a',
        body: { email: 'recipient@example.test' },
        invitationOperationId: operationId,
        successStatus: 202,
        schema: z.strictObject({ status: z.literal('invited') }),
      },
      {
        expectedSession: expected,
        headers: new Headers({ 'x-invitation-operation-id': 'browser-unvalidated-id' }),
      },
      deps
    )
    expect(result.data).toEqual({ status: 'invited' })
    const headers = vi.mocked(deps.fetch!).mock.calls[0]![1]!.headers as Headers
    expect(headers.get('x-invitation-operation-id')).toBe(operationId)
  })

  it('maps genuinely empty204 to a typed envelope and rejects another2xx or a body', async () => {
    const { deps, expected } = fixture()
    const revoke = {
      method: 'DELETE' as const,
      path: '/api/v1/organizations/org-a/invites/invite-a',
      organizationId: 'org-a',
      bodyMode: 'empty' as const,
      successStatus: 204 as const,
      acknowledgment: { status: 'revoked' as const },
      schema: z.strictObject({ status: z.literal('revoked') }),
    }
    deps.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    expect(
      await executeContextOperation(
        revoke,
        { expectedSession: expected, headers: new Headers() },
        deps
      )
    ).toEqual({ binding: expected, data: { status: 'revoked' } })
    deps.fetch = vi.fn().mockResolvedValue(Response.json({ status: 'revoked' }, { status: 200 }))
    await expect(
      executeContextOperation(revoke, { expectedSession: expected, headers: new Headers() }, deps)
    ).rejects.toMatchObject({ status: 502, errorCode: 'INVALID_UPSTREAM_RESPONSE' })
    deps.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204, body: new ReadableStream() })
    await expect(
      executeContextOperation(revoke, { expectedSession: expected, headers: new Headers() }, deps)
    ).rejects.toMatchObject({ status: 502 })
  })

  it('rejects another actor and same-actor re-login before refresh/domain work', async () => {
    for (const actorId of ['actor-x', 'actor-y']) {
      const { deps, entry, expected } = fixture(true)
      ;(deps.store as FakeVaultStore).seed('session-y', {
        ...entry,
        userSnapshot: { ...entry.userSnapshot, id: actorId },
      })
      deps.readSessionId = vi.fn().mockResolvedValue('session-y')
      await expect(
        executeContextOperation(
          operation,
          { expectedSession: expected, headers: new Headers() },
          deps
        )
      ).rejects.toMatchObject({ status: 409 })
      expect(deps.upstreamRefresh).not.toHaveBeenCalled()
      expect(deps.fetch).not.toHaveBeenCalled()
    }
  })

  it('lets safe shared refresh finish CAS after caller retirement without starting the domain call', async () => {
    const { deps, expected } = fixture(true)
    let resolve!: (value: Awaited<ReturnType<typeof freshRefresh>>) => void
    deps.upstreamRefresh = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<typeof freshRefresh>>>((done) => {
          resolve = done
        })
    )
    const controller = new AbortController()
    const pending = executeContextOperation(
      operation,
      { expectedSession: expected, headers: new Headers(), signal: controller.signal },
      deps
    )
    await vi.waitFor(() => expect(deps.upstreamRefresh).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolve(await freshRefresh())
    await vi.waitFor(async () =>
      expect(await deps.store.get('session-x')).toMatchObject({ version: 2 })
    )
    expect(deps.fetch).not.toHaveBeenCalled()
  })
  it('makes native 0 switch / 1 PATCH / 0 refresh and reuses one captured vault read', async () => {
    const { deps, expected, get } = fixture()
    const result = await executeContextOperation(
      operation,
      {
        expectedSession: expected,
        headers: new Headers({
          'x-amcore-organization-id': 'org-b',
          'x-amcore-context-session': 'browser',
          authorization: 'Bearer browser',
          cookie: 'foreign',
          'x-forwarded-for': 'foreign',
        }),
      },
      deps
    )
    expect(result).toEqual({ binding: expected, data: { name: 'Renamed' } })
    expect(get).toHaveBeenCalledTimes(1)
    expect(deps.upstreamRefresh).not.toHaveBeenCalled()
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(deps.fetch!).mock.calls[0]!
    expect(url).toBe('http://api.test/api/v1/context-rehearsal/workspaces/org-a')
    expect(init!.method).toBe('PATCH')
    const headers = init!.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer at-1')
    expect(headers.get('x-amcore-organization-id')).toBe('org-a')
    for (const stripped of ['cookie', 'x-forwarded-for', 'x-amcore-context-session'])
      expect(headers.has(stripped)).toBe(false)
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Renamed' })
  })

  it('rejects missing binding before cookie/vault and changed identity before refresh/domain', async () => {
    const { deps, get } = fixture(true)
    await expect(
      executeContextOperation(
        operation,
        { expectedSession: undefined, headers: new Headers() },
        deps
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.readSessionId).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(deps.fetch).not.toHaveBeenCalled()
    await expect(
      executeContextOperation(
        operation,
        { expectedSession: '0'.repeat(64), headers: new Headers() },
        deps
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(deps.upstreamRefresh).not.toHaveBeenCalled()
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('refreshes at most once and keeps identity binding across CAS/version rotation', async () => {
    const { deps, expected } = fixture(true)
    await executeContextOperation(
      operation,
      { expectedSession: expected, headers: new Headers() },
      deps
    )
    expect(deps.upstreamRefresh).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(
      (vi.mocked(deps.fetch!).mock.calls[0]![1]!.headers as Headers).get('authorization')
    ).toBe('Bearer at-2')
  })

  it('rejects malformed target before cookie/vault/refresh/domain', async () => {
    const { deps, expected } = fixture()
    await expect(
      executeContextOperation(
        { ...operation, organizationId: '../foreign' },
        { expectedSession: expected, headers: new Headers() },
        deps
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.readSessionId).not.toHaveBeenCalled()
    expect(deps.upstreamRefresh).not.toHaveBeenCalled()
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('caller abort during vault lookup cannot start a later domain callback', async () => {
    const { deps, expected } = fixture()
    let resolve!: (value: ReturnType<typeof makeEntry>) => void
    deps.store.get = vi.fn(
      () =>
        new Promise<ReturnType<typeof makeEntry>>((done) => {
          resolve = done
        })
    )
    const controller = new AbortController()
    const pending = executeContextOperation(
      operation,
      { expectedSession: expected, headers: new Headers(), signal: controller.signal },
      deps
    )
    await vi.waitFor(() => expect(deps.store.get).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolve(makeEntry({ userSnapshot: { id: 'actor-x' } as never }))
    await Promise.resolve()
    expect(deps.fetch).not.toHaveBeenCalled()
  })
  it('requires exact200 acknowledgment for member writes, rejects201/204 without replay', async () => {
    for (const status of [201, 204]) {
      const { deps, expected } = fixture()
      deps.fetch = vi
        .fn()
        .mockResolvedValue(
          status === 204
            ? new Response(null, { status })
            : Response.json({ name: 'Renamed' }, { status })
        )
      await expect(
        executeContextOperation(
          { ...operation, successStatus: 200 },
          { expectedSession: expected, headers: new Headers() },
          deps
        )
      ).rejects.toMatchObject({ status: 502, errorCode: 'INVALID_UPSTREAM_RESPONSE' })
      expect(deps.fetch).toHaveBeenCalledTimes(1)
    }
  })
  it('bounds the final response envelope including binding at1048576/1048577 bytes', async () => {
    for (const bytes of [1048576, 1048577]) {
      const { deps, expected } = fixture()
      const empty = JSON.stringify({ binding: expected, data: { name: '' } })
      deps.fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ name: 'x'.repeat(bytes - Buffer.byteLength(empty)) }))
      const pending = executeContextOperation(
        { ...operation, responseBytes: 1048576 },
        { expectedSession: expected, headers: new Headers() },
        deps
      )
      if (bytes === 1048576) {
        const result = await pending
        expect(Buffer.byteLength(JSON.stringify(result))).toBe(bytes)
      } else await expect(pending).rejects.toMatchObject({ status: 502 })
      expect(deps.fetch).toHaveBeenCalledTimes(1)
    }
  })
  it('canonicalizes Retry-After on safe503 while preserving uncertain write code', async () => {
    const { deps, expected } = fixture()
    deps.fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { errorCode: 'MEMBER_ROLES_SAVE_UNAVAILABLE' },
          { status: 503, headers: { 'Retry-After': '2.1' } }
        )
      )
    await expect(
      executeContextOperation(
        operation,
        { expectedSession: expected, headers: new Headers() },
        deps
      )
    ).rejects.toMatchObject({
      status: 503,
      errorCode: 'MEMBER_ROLES_SAVE_UNAVAILABLE',
      retryAfterSeconds: 3,
    })
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['100%', 'Legal / Finance', 'A\\B'])(
    'preserves literal search query %s',
    async (search) => {
      const { deps, expected } = fixture()
      await executeContextOperation(
        {
          ...operation,
          path: operation.path.split('?')[0] + '?' + new URLSearchParams({ search }),
        },
        { expectedSession: expected, headers: new Headers() },
        deps
      )
      const sent = new URL(String(vi.mocked(deps.fetch!).mock.calls[0]![0]))
      expect(sent.searchParams.get('search')).toBe(search)
      expect(deps.fetch).toHaveBeenCalledTimes(1)
    }
  )
  it.each([
    '/api/v1/../auth',
    '/api/v1/%2e%2e/auth',
    '/api/v1/org%2fother',
    '/api/v1/org%5cother',
    '/api/v1/%252e',
    'https://evil.test/api/v1/',
    '//evil.test/api/v1/',
  ])('rejects malicious pathname %s before credentials', async (path) => {
    const { deps, expected } = fixture()
    await expect(
      executeContextOperation(
        { ...operation, path },
        { expectedSession: expected, headers: new Headers() },
        deps
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.readSessionId).not.toHaveBeenCalled()
    expect(deps.fetch).not.toHaveBeenCalled()
  })
})
