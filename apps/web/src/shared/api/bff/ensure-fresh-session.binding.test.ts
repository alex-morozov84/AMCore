// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import { ensureFreshSession } from './ensure-fresh-session'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes'
import { SimpleLock } from './test-lock-fakes'

vi.mock('server-only', () => ({}))
const changed = () => new ContextRequestError(401, 'AUTH_CONTEXT_CHANGED')

describe('Every vault return requires current primary browser authority', () => {
  it.each([true, false])(
    'refuses an obsolete cookie before fresh=%s or automatic refresh',
    async (fresh) => {
      const store = new FakeVaultStore()
      store.seed('old-cookie', makeEntry({ accessTokenExpiresAt: fresh ? Date.now() + 120000 : 0 }))
      const upstreamRefresh = vi.fn(freshRefresh)
      const verifyBinding = vi.fn().mockRejectedValue(changed())
      await expect(
        ensureFreshSession('old-cookie', {
          store,
          lock: new SimpleLock(),
          upstreamRefresh,
          verifyBinding,
        })
      ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
      expect(upstreamRefresh).not.toHaveBeenCalled()
    }
  )

  it('checks a changed lock reread before exposing another request’s fresh token', async () => {
    const store = new FakeVaultStore()
    store.seed('cookie', makeEntry({ accessTokenExpiresAt: 0 }))
    const verifyBinding = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(changed())
    const upstreamRefresh = vi.fn(freshRefresh)
    await expect(
      ensureFreshSession('cookie', {
        store,
        lock: new SimpleLock(),
        upstreamRefresh,
        verifyBinding,
      })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(verifyBinding).toHaveBeenCalledTimes(2)
    expect(upstreamRefresh).not.toHaveBeenCalled()
  })

  it('checks the rotated result before CAS and never stores changed authority', async () => {
    const store = new FakeVaultStore()
    store.seed('cookie', makeEntry({ accessTokenExpiresAt: 0 }))
    const write = vi.spyOn(store, 'setIfVersionMatches')
    const verifyBinding = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(changed())
    await expect(
      ensureFreshSession('cookie', {
        store,
        lock: new SimpleLock(),
        upstreamRefresh: vi.fn(freshRefresh),
        verifyBinding,
      })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(write).not.toHaveBeenCalled()
  })

  it('checks a CAS winner before returning it and cannot trust another vault version', async () => {
    const store = new FakeVaultStore()
    store.seed('cookie', makeEntry({ accessTokenExpiresAt: 0 }))
    // Another writer's newer entry wins the compare-and-set. A different version alone proves
    // nothing: it is returned only after the same mandatory binding verification.
    vi.spyOn(store, 'setIfVersionMatches').mockImplementation(async () => {
      store.seed(
        'cookie',
        makeEntry({ refreshToken: 'rt-other', accessTokenExpiresAt: 0, version: 2 })
      )
      return false
    })
    const verifyBinding = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(changed())
    await expect(
      ensureFreshSession('cookie', {
        store,
        lock: new SimpleLock(),
        upstreamRefresh: vi.fn(freshRefresh),
        verifyBinding,
      })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(verifyBinding).toHaveBeenCalledTimes(4)
  })
})
