// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentVaultSession } from './current-session'
import { handleLogout } from './logout-handler'
import { makeRequest } from './logout-handler.test-helpers'
import { isTrustedOrigin } from './origin-guard'
import { redisVaultStore } from './session-vault-store'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./current-session', () => ({ getCurrentVaultSession: vi.fn() }))
vi.mock('./session-vault-store', () => ({ redisVaultStore: { delete: vi.fn() } }))

// `logout-handler.ts` deliberately has no import of `./ensure-fresh-session`
// at all — logout must never refresh/rotate the token pair first. That's a
// structural guarantee (visible by reading the module's imports), not
// something a runtime mock can meaningfully assert.

describe('handleLogout — CSRF gating and no-session case', () => {
  beforeEach(() => {
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
    vi.mocked(redisVaultStore.delete).mockResolvedValue(undefined)
  })

  it('rejects an untrusted origin with 403 without touching the session', async () => {
    vi.mocked(isTrustedOrigin).mockReturnValue(false)

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(403)
    expect(getCurrentVaultSession).not.toHaveBeenCalled()
  })

  it('clears the cookie and returns 200 even with no current session (already logged out)', async () => {
    vi.mocked(getCurrentVaultSession).mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await handleLogout(makeRequest())

    expect(response.status).toBe(200)
    expect(response.cookies.get('amcore_session')?.value).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(redisVaultStore.delete).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
