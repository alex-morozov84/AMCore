vi.mock('next/headers', () => ({ headers: vi.fn(async () => boundHeaders()) }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { UserResponse } from '@amcore/shared'

import { getOptionalSession } from '@/shared/api/bff/dal'
import { getOptionalSessionEntry } from '@/shared/api/bff/dal'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getConsoleAwareAccessToken, getConsoleAwareUser } from './access-token'
import { getConsoleSessionEntry } from './session'

// Mocked wholesale (not just `@/i18n/navigation`) so this test never pulls in
// `dal.ts`'s own transitive next-intl navigation import - unrelated to what
// this test actually exercises, and unresolvable in this test environment.
vi.mock('@/shared/api/bff/dal', () => ({
  getOptionalSession: vi.fn(),
  getOptionalSessionEntry: vi.fn(),
}))
vi.mock('./session', () => ({
  getConsoleAccessToken: vi.fn(),
  getConsoleSessionEntry: vi.fn(),
}))

const mockedAccessToken = vi.mocked(getOptionalSessionEntry)
const mockedConsoleAccessToken = vi.mocked(getConsoleSessionEntry)
const mockedOptionalSession = vi.mocked(getOptionalSession)
const mockedConsoleSessionEntry = vi.mocked(getConsoleSessionEntry)
function boundHeaders() {
  return new Headers({
    cookie: `amcore_browser_context=${'a'.repeat(43)}; __Host-amcore_console_context=${'b'.repeat(43)}`,
  })
}
function boundEntry(accessToken: string) {
  const audience = mutableConfig.mode === 'host' ? 'console' : 'product'
  return {
    accessToken,
    audience,
    browser: { audience, contextId: 'ctx', generation: 1, familyId: 'family', securityVersion: 0 },
  } as never
}
const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

const fakeUser = { id: 'u1', email: 'u1@example.com' } as unknown as UserResponse

describe('getConsoleAwareAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
  })

  afterEach(() => {
    mutableConfig.mode = originalMode
  })

  it('uses the product session in path mode', async () => {
    mutableConfig.mode = 'path'
    mockedAccessToken.mockResolvedValue(boundEntry('product-token'))

    await expect(getConsoleAwareAccessToken()).resolves.toMatchObject({
      accessToken: 'product-token',
      browserHeaders: { 'x-amcore-browser-audience': 'product' },
    })
    expect(mockedConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('uses the isolated console session in host mode, never the product session', async () => {
    mutableConfig.mode = 'host'
    mockedConsoleAccessToken.mockResolvedValue(boundEntry('console-token'))

    await expect(getConsoleAwareAccessToken()).resolves.toMatchObject({
      accessToken: 'console-token',
      browserHeaders: { 'x-amcore-browser-audience': 'console' },
    })
    expect(mockedAccessToken).not.toHaveBeenCalled()
  })
})

describe('getConsoleAwareUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
  })

  afterEach(() => {
    mutableConfig.mode = originalMode
  })

  it('reads the product session user in path mode', async () => {
    mutableConfig.mode = 'path'
    mockedOptionalSession.mockResolvedValue({ user: fakeUser })

    await expect(getConsoleAwareUser()).resolves.toEqual(fakeUser)
    expect(mockedConsoleSessionEntry).not.toHaveBeenCalled()
  })

  it('returns null in path mode when genuinely logged out', async () => {
    mutableConfig.mode = 'path'
    mockedOptionalSession.mockResolvedValue(null)

    await expect(getConsoleAwareUser()).resolves.toBeNull()
  })

  it('reads the isolated console session user in host mode, never the product session', async () => {
    mutableConfig.mode = 'host'
    mockedConsoleSessionEntry.mockResolvedValue({ userSnapshot: fakeUser } as never)

    await expect(getConsoleAwareUser()).resolves.toEqual(fakeUser)
    expect(mockedOptionalSession).not.toHaveBeenCalled()
  })

  it('returns null in host mode when there is no console session', async () => {
    mutableConfig.mode = 'host'
    mockedConsoleSessionEntry.mockResolvedValue(null)

    await expect(getConsoleAwareUser()).resolves.toBeNull()
  })
})
