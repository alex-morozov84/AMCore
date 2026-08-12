// @vitest-environment node
import type * as ReactModule from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { redirect } from '@/i18n/navigation'

import { redirectIfAuthenticated, requireSession } from './dal'
import { fakeUser, fakeVaultEntry, mockSessionCookie } from './dal.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { SessionVaultUnavailableError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en') }))
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }))
// See dal.optional-session.test.ts for why cache() is identity-mocked here.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  cache: <T>(fn: T) => fn,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireSession — the real protected-page gate', () => {
  it('returns the session when one exists', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())

    expect(await requireSession()).toEqual({ user: fakeUser })
  })

  it('redirects to /login when there is no session', async () => {
    mockSessionCookie(undefined)

    await requireSession()

    expect(redirect).toHaveBeenCalledWith({ href: '/login', locale: 'en' })
  })

  it('rethrows — does not redirect — when auth could not be proven', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )

    await expect(requireSession()).rejects.toBeInstanceOf(SessionVaultUnavailableError)
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('redirectIfAuthenticated — the auth-pages redirect-away check', () => {
  it('redirects to / when a session exists', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockResolvedValue(fakeVaultEntry())

    await redirectIfAuthenticated('en')

    expect(redirect).toHaveBeenCalledWith({ href: '/', locale: 'en' })
  })

  it('does nothing when there is no session', async () => {
    mockSessionCookie(undefined)

    await redirectIfAuthenticated('en')

    expect(redirect).not.toHaveBeenCalled()
  })

  it('fails open (renders the form) instead of throwing when auth could not be proven', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(redirectIfAuthenticated('en')).resolves.toBeUndefined()

    expect(redirect).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
