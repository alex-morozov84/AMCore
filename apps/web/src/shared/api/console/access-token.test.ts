import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { UserResponse } from '@amcore/shared'

import { getOptionalSession } from '@/shared/api/bff/dal'
import { getBackendAccessToken } from '@/shared/api/server/access-token'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getConsoleAwareAccessToken, getConsoleAwareUser } from './access-token'
import { getConsoleAccessToken, getConsoleSessionEntry } from './session'

vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: vi.fn() }))
// Mocked wholesale (not just `@/i18n/navigation`) so this test never pulls in
// `dal.ts`'s own transitive next-intl navigation import - unrelated to what
// this test actually exercises, and unresolvable in this test environment.
vi.mock('@/shared/api/bff/dal', () => ({ getOptionalSession: vi.fn() }))
vi.mock('./session', () => ({
  getConsoleAccessToken: vi.fn(),
  getConsoleSessionEntry: vi.fn(),
}))

const mockedAccessToken = vi.mocked(getBackendAccessToken)
const mockedConsoleAccessToken = vi.mocked(getConsoleAccessToken)
const mockedOptionalSession = vi.mocked(getOptionalSession)
const mockedConsoleSessionEntry = vi.mocked(getConsoleSessionEntry)
const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

const fakeUser = { id: 'u1', email: 'u1@example.com' } as unknown as UserResponse

describe('getConsoleAwareAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    mutableConfig.mode = originalMode
  })

  it('uses the product session in path mode', async () => {
    mutableConfig.mode = 'path'
    mockedAccessToken.mockResolvedValue('product-token')

    await expect(getConsoleAwareAccessToken()).resolves.toBe('product-token')
    expect(mockedConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('uses the isolated console session in host mode, never the product session', async () => {
    mutableConfig.mode = 'host'
    mockedConsoleAccessToken.mockResolvedValue('console-token')

    await expect(getConsoleAwareAccessToken()).resolves.toBe('console-token')
    expect(mockedAccessToken).not.toHaveBeenCalled()
  })
})

describe('getConsoleAwareUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
