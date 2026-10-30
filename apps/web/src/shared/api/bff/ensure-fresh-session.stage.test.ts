// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBrowserBindingVerifier } from './browser-binding.server'
import { ensureFreshSession } from './ensure-fresh-session'
import { SessionStageTimeoutError } from './errors'
import { FakeVaultStore, makeBrowserEntry, makeEntry } from './test-fakes'
import { SimpleLock } from './test-lock-fakes'

vi.mock('server-only', () => ({}))

// The caller stage is an absolute budget: every step is a checked dispatch, and a step that
// finishes after the budget is not accepted. The monotonic clock is injected.
describe('caller stage', () => {
  let store: FakeVaultStore
  beforeEach(() => {
    store = new FakeVaultStore()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts no binding check when the vault read finished after the stage was spent', async () => {
    let now = 0
    store.seed('s1', makeEntry())
    vi.spyOn(store, 'get').mockImplementation(async () => {
      now += 5000
      return makeEntry()
    })
    const verifyBinding = vi.fn(async () => undefined)
    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new SimpleLock(),
        verifyBinding,
        upstreamRefresh: vi.fn(),
        timing: { clock: () => now },
      })
    ).rejects.toBeInstanceOf(SessionStageTimeoutError)
    expect(verifyBinding).not.toHaveBeenCalled()
  })

  it('does not return a fresh entry whose binding check finished after the stage was spent', async () => {
    let now = 0
    store.seed('s1', makeEntry())
    const verifyBinding = vi.fn(async () => {
      now += 5000
    })
    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new SimpleLock(),
        verifyBinding,
        upstreamRefresh: vi.fn(),
        timing: { clock: () => now },
      })
    ).rejects.toBeInstanceOf(SessionStageTimeoutError)
  })

  it('starts no owner when the binding check finished after the stage was spent', async () => {
    let now = 0
    store.seed('s1', makeEntry({ accessTokenExpiresAt: 0 }))
    const upstreamRefresh = vi.fn()
    const lock = new SimpleLock()
    const acquire = vi.spyOn(lock, 'acquire')
    await expect(
      ensureFreshSession('s1', {
        store,
        lock,
        verifyBinding: async () => {
          now += 5000
        },
        upstreamRefresh,
        timing: { clock: () => now },
      })
    ).rejects.toBeInstanceOf(SessionStageTimeoutError)
    expect(acquire).not.toHaveBeenCalled()
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })

  it('a healthy request still passes: fresh entry, real clock', async () => {
    store.seed('s1', makeEntry())
    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new SimpleLock(),
        verifyBinding: async () => undefined,
        upstreamRefresh: vi.fn(),
      })
    ).resolves.toMatchObject({ version: 1 })
  })
})

// The composition that unit-level fakes missed: a fractional remaining time reaching the real
// verifier. The native timeout accepts only integers.
describe('stage to real binding verifier', () => {
  const anchor = 'a'.repeat(43)
  beforeEach(() => {
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-binding-unit-private-transport-key-at-least-32>')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('dispatches the probe with a fractional remainder instead of throwing a RangeError', async () => {
    const store = new FakeVaultStore()
    const entry = makeBrowserEntry({
      userSnapshot: { ...makeEntry().userSnapshot, id: 'user-A' },
      refreshToken: '1'.repeat(64),
    })
    store.seed('s1', entry)
    const send = vi.fn().mockResolvedValue(
      Response.json({
        status: 'current',
        userId: 'user-A',
        contextId: entry.browser!.contextId,
        generation: entry.browser!.generation,
        familyId: entry.browser!.familyId,
        securityVersion: entry.browser!.securityVersion,
        audience: 'product',
      })
    )
    vi.stubGlobal('fetch', send)
    const headers = new Headers({ cookie: `amcore_browser_context=${anchor}` })
    // A clock whose reading is fractional, as performance.now() normally is.
    let tick = 0.37
    await expect(
      ensureFreshSession('s1', {
        store,
        lock: new SimpleLock(),
        verifyBinding: createBrowserBindingVerifier(headers, 'product'),
        upstreamRefresh: vi.fn(),
        timing: { clock: () => (tick += 0.123) },
      })
    ).resolves.toMatchObject({ version: 1 })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
