import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getBackendAccessToken } from '@/shared/api/server/access-token'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { probeConsoleAccess } from './access-probe'
import { getConsoleAccessToken } from './session'

vi.mock('@/shared/api/server/access-token', () => ({ getBackendAccessToken: vi.fn() }))
// `./access-probe` imports `./access-token`, which also exports
// `getConsoleAwareUser` (unused here) backed by `dal.ts` - mocked wholesale
// so this test never pulls in `dal.ts`'s own transitive next-intl
// navigation import, unresolvable in this test environment.
vi.mock('@/shared/api/bff/dal', () => ({ getOptionalSession: vi.fn() }))
vi.mock('./session', () => ({
  getConsoleAccessToken: vi.fn(),
  getConsoleSessionEntry: vi.fn(),
}))

const mockedAccessToken = vi.mocked(getBackendAccessToken)
const mockedConsoleAccessToken = vi.mocked(getConsoleAccessToken)
const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

describe('probeConsoleAccess', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mutableConfig.mode = 'path'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    mutableConfig.mode = originalMode
  })

  it('fails closed without a server-held bearer credential', async () => {
    mockedAccessToken.mockResolvedValue(null)

    const status = await probeConsoleAccess()

    expect(status).toBe(401)
  })

  it('forwards only the no-content success status', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const status = await probeConsoleAccess()

    expect(status).toBe(204)
  })

  it.each([401, 403])('forwards expected policy denial %i without a body', async (status) => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))

    const result = await probeConsoleAccess()

    expect(result).toBe(status)
  })

  it('fails closed when the policy probe is unavailable', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')))

    const status = await probeConsoleAccess()

    expect(status).toBe(503)
  })

  it('does not disclose an unexpected upstream response', async () => {
    mockedAccessToken.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unexpected', { status: 500 })))

    const status = await probeConsoleAccess()

    expect(status).toBe(503)
  })

  it('fails closed when server-held bearer acquisition rejects', async () => {
    mockedAccessToken.mockRejectedValue(new Error('vault unavailable'))

    await expect(probeConsoleAccess()).resolves.toBe(503)
  })

  it('uses only the console-held bearer in host mode', async () => {
    mutableConfig.mode = 'host'
    mockedConsoleAccessToken.mockResolvedValue('console-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(probeConsoleAccess()).resolves.toBe(204)

    expect(mockedAccessToken).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:5002/api/v1/admin/access',
      expect.objectContaining({ headers: { Authorization: 'Bearer console-token' } })
    )
  })
})
