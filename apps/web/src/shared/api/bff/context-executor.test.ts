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
})
