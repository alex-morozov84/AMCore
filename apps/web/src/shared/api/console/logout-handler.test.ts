// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedConsoleOrigin: vi.fn() }))
vi.mock('./session', () => ({ getCurrentConsoleSession: vi.fn() }))
vi.mock('./session-vault-store', () => ({ redisConsoleVaultStore: { delete: vi.fn() } }))
vi.mock('@/shared/api/bff/backend-session-revocation', () => ({ revokeBackendSession: vi.fn() }))

import { revokeBackendSession } from '@/shared/api/bff/backend-session-revocation'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { handleConsoleLogout } from './logout-handler'
import { isTrustedConsoleOrigin } from './origin-guard'
import { getCurrentConsoleSession } from './session'
import { redisConsoleVaultStore } from './session-vault-store'

const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

function request(): Request {
  return new Request('https://console.example.test/api/auth/logout', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mutableConfig.mode = 'host'
  vi.mocked(isTrustedConsoleOrigin).mockReturnValue(true)
  vi.mocked(getCurrentConsoleSession).mockResolvedValue(null)
})

describe('handleConsoleLogout', () => {
  it('rejects a non-console mode before inspecting cookies', async () => {
    mutableConfig.mode = 'path'

    await expect(handleConsoleLogout(request())).resolves.toMatchObject({ status: 404 })
    expect(getCurrentConsoleSession).not.toHaveBeenCalled()
  })

  it('rejects an untrusted state-changing origin', async () => {
    vi.mocked(isTrustedConsoleOrigin).mockReturnValue(false)

    await expect(handleConsoleLogout(request())).resolves.toMatchObject({ status: 403 })
    expect(getCurrentConsoleSession).not.toHaveBeenCalled()
  })

  it('revokes and deletes only the console vault session', async () => {
    vi.mocked(getCurrentConsoleSession).mockResolvedValue({
      sessionId: 'console-session',
      entry: { refreshToken: 'refresh-token', audience: 'console' },
    } as never)

    const response = await handleConsoleLogout(request())

    expect(response.status).toBe(204)
    expect(revokeBackendSession).toHaveBeenCalledWith('refresh-token')
    expect(redisConsoleVaultStore.delete).toHaveBeenCalledWith('console-session')
    expect(response.headers.get('set-cookie')).toContain('__Host-amcore_console_session=')
  })

  it('clears the browser cookie when console vault deletion fails', async () => {
    vi.mocked(getCurrentConsoleSession).mockResolvedValue({
      sessionId: 'console-session',
      entry: { refreshToken: 'refresh-token', audience: 'console' },
    } as never)
    vi.mocked(redisConsoleVaultStore.delete).mockRejectedValue(new Error('redis unavailable'))

    const response = await handleConsoleLogout(request())

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('__Host-amcore_console_session=')
  })
})

afterEach(() => {
  mutableConfig.mode = originalMode
})
