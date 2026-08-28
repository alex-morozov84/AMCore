// init:project --mode=single: dal.gating.test.ts, kept in sync with
// project-plan-web-nav-bff.mjs's rewrite of dal.ts itself. This test mocks
// and asserts against the old next-intl redirect({href,locale}) shape
// directly (not just an import path), so a full-file rewrite is clearer
// than several small patches that would together cover nearly the whole
// file anyway.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `// @vitest-environment node
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
`

const AFTER = `// @vitest-environment node
import type * as ReactModule from 'react'
import { redirect } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { redirectIfAuthenticated, requireSession } from './dal'
import { fakeUser, fakeVaultEntry, mockSessionCookie } from './dal.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { SessionVaultUnavailableError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
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

    expect(redirect).toHaveBeenCalledWith('/login')
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

    await redirectIfAuthenticated()

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('does nothing when there is no session', async () => {
    mockSessionCookie(undefined)

    await redirectIfAuthenticated()

    expect(redirect).not.toHaveBeenCalled()
  })

  it('fails open (renders the form) instead of throwing when auth could not be proven', async () => {
    mockSessionCookie('sess-1')
    vi.mocked(ensureFreshSession).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(redirectIfAuthenticated()).resolves.toBeUndefined()

    expect(redirect).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
`

export function buildWebNavDalGatingTestSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/api/bff/dal.gating.test.ts'),
      { expectedBefore: BEFORE, after: AFTER },
      'dal.gating.test.ts: mock next/navigation and assert the plain-string redirect contract'
    ),
  ]
}
