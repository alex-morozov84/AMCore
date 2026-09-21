// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedConsoleOrigin: vi.fn() }))
vi.mock('./access-probe', () => ({ probeConsoleAccessWithToken: vi.fn() }))
vi.mock('./session', () => ({ mintConsoleSession: vi.fn() }))
vi.mock('@/shared/api/bff/backend-session-revocation', () => ({ revokeBackendSession: vi.fn() }))
vi.mock('@/shared/api/bff/upstream-auth', () => ({
  UpstreamAuthError: class UpstreamAuthError extends Error {},
  callUpstreamAuth: vi.fn(),
}))

import { revokeBackendSession } from '@/shared/api/bff/backend-session-revocation'
import { callUpstreamAuth } from '@/shared/api/bff/upstream-auth'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { probeConsoleAccessWithToken } from './access-probe'
import { handleConsoleLogin } from './auth-handler'
import { isTrustedConsoleOrigin } from './origin-guard'
import { mintConsoleSession } from './session'

const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

function request(): Request {
  return new Request('https://console.example.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'Password123' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mutableConfig.mode = 'host'
  vi.mocked(isTrustedConsoleOrigin).mockReturnValue(true)
  vi.mocked(callUpstreamAuth).mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user-1' },
  } as never)
  vi.mocked(probeConsoleAccessWithToken).mockResolvedValue({ kind: 'admitted' })
  vi.mocked(mintConsoleSession).mockResolvedValue('console-session')
})

describe('handleConsoleLogin', () => {
  it('rejects non-host mode before authenticating', async () => {
    mutableConfig.mode = 'path'

    await expect(handleConsoleLogin(request())).resolves.toMatchObject({ status: 404 })
    expect(callUpstreamAuth).not.toHaveBeenCalled()
  })

  it('rejects an untrusted browser origin before authenticating', async () => {
    vi.mocked(isTrustedConsoleOrigin).mockReturnValue(false)

    const response = await handleConsoleLogin(request())

    expect(response.status).toBe(403)
    expect(callUpstreamAuth).not.toHaveBeenCalled()
  })

  it('mints only a live-super-admin console session', async () => {
    const response = await handleConsoleLogin(request())

    expect(response.status).toBe(204)
    expect(mintConsoleSession).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' })
    )
    expect(response.headers.get('set-cookie')).toContain(
      '__Host-amcore_console_session=console-session'
    )
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('revokes a rejected backend login without minting a console session', async () => {
    vi.mocked(probeConsoleAccessWithToken).mockResolvedValue({ kind: 'denied', status: 403 })

    const response = await handleConsoleLogin(request())

    expect(response.status).toBe(403)
    expect(mintConsoleSession).not.toHaveBeenCalled()
    expect(revokeBackendSession).toHaveBeenCalledWith('refresh-token')
  })

  it('fails closed when the live policy probe is unavailable', async () => {
    vi.mocked(probeConsoleAccessWithToken).mockResolvedValue({ kind: 'upstream-unavailable' })

    await expect(handleConsoleLogin(request())).resolves.toMatchObject({ status: 503 })
    expect(mintConsoleSession).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  mutableConfig.mode = originalMode
})
