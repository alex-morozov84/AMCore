// @vitest-environment node
import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getOptionalSession } from './dal'
import { fakeUser, fakeVaultEntry, mockSessionCookie } from './dal.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import {
  isInvalidRefreshError,
  SessionNotFoundError,
  SessionRefreshUnsafeError,
  SessionVaultUnavailableError,
} from './errors'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en') }))
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }))
// `cache()` is per-request in real Next.js (fresh scope per render, via
// AsyncLocalStorage). Outside that context — a plain test — its actual
// memoization semantics aren't the thing under test and would risk one
// test's mocked result leaking into the next; make it an identity wrapper
// so each test only exercises `dal.ts`'s own logic.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  cache: <T>(fn: T) => fn,
}))

describe('getOptionalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null without calling ensureFreshSession when there is no cookie', async () => {
    mockSessionCookie(undefined)

    expect(await getOptionalSession()).toBeNull()
    expect(ensureFreshSession).not.toHaveBeenCalled()
  })

  it('returns the user snapshot on a valid session', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())

    expect(await getOptionalSession()).toEqual({ user: fakeUser })
  })

  it.each([
    ['SessionNotFoundError', new SessionNotFoundError('sess-1')],
    ['SessionRefreshUnsafeError', new SessionRefreshUnsafeError('sess-1')],
  ])('treats %s as logged out (returns null)', async (_name, error) => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(error)

    expect(await getOptionalSession()).toBeNull()
  })

  it('treats an explicit invalid-refresh error as logged out (returns null)', async () => {
    mockSessionCookie('sess-1')
    const invalidRefreshError = Object.assign(new Error('rejected'), { code: 'invalid' })
    vi.mocked(ensureFreshSession).mockRejectedValue(invalidRefreshError)
    expect(isInvalidRefreshError(invalidRefreshError)).toBe(true)

    expect(await getOptionalSession()).toBeNull()
  })

  it('rethrows SessionVaultUnavailableError instead of treating it as logged out', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('ECONNREFUSED'))
    )

    await expect(getOptionalSession()).rejects.toBeInstanceOf(SessionVaultUnavailableError)
  })

  it('rethrows an uncoded/transient upstream error instead of treating it as logged out', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(new Error('network blip'))

    await expect(getOptionalSession()).rejects.toThrow('network blip')
  })
})
