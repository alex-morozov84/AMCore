// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedConsoleOrigin: vi.fn() }))
vi.mock('./session', () => ({ getConsoleSessionEntry: vi.fn() }))
vi.mock('@/shared/api/bff/dal', () => ({ getOptionalSessionEntry: vi.fn() }))
vi.mock('@/shared/api/bff/origin-guard', () => ({ isTrustedOrigin: vi.fn() }))

import { getOptionalSessionEntry } from '@/shared/api/bff/dal'
import { SessionNotFoundError, SessionVaultUnavailableError } from '@/shared/api/bff/errors'
import { isTrustedOrigin } from '@/shared/api/bff/origin-guard'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import { isTrustedConsoleOrigin } from './origin-guard'
import { getConsoleSessionEntry } from './session'

const mutableConfig = ADMIN_CONSOLE_CONFIG as { mode: 'disabled' | 'path' | 'host' }
const originalMode = ADMIN_CONSOLE_CONFIG.mode

function request(method = 'PATCH'): Request {
  const host = mutableConfig.mode === 'host' ? 'console.example.test' : 'app.example.test'
  return new Request(`https://${host}/api/console/users/u1/role`, {
    method,
    headers: {
      host,
      cookie: `amcore_browser_context=${'a'.repeat(43)}; __Host-amcore_console_context=${'b'.repeat(43)}`,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test')
  vi.stubEnv('ADMIN_CONSOLE_ORIGIN', 'https://console.example.test')
  vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', 'console.example.test')
  mutableConfig.mode = originalMode
})

afterEach(() => vi.unstubAllEnvs())

describe('isConsoleRequestOriginTrusted', () => {
  it('uses the strict console-host check in host mode', () => {
    mutableConfig.mode = 'host'
    vi.mocked(isTrustedConsoleOrigin).mockReturnValue(true)

    expect(isConsoleRequestOriginTrusted(request())).toBe(true)
    expect(isTrustedConsoleOrigin).toHaveBeenCalled()
    expect(isTrustedOrigin).not.toHaveBeenCalled()
  })

  it('uses the product origin check in path mode', () => {
    mutableConfig.mode = 'path'
    vi.mocked(isTrustedOrigin).mockReturnValue(true)

    expect(isConsoleRequestOriginTrusted(request())).toBe(true)
    expect(isTrustedOrigin).toHaveBeenCalled()
    expect(isTrustedConsoleOrigin).not.toHaveBeenCalled()
  })
})

describe('resolveConsoleAccessToken', () => {
  it('host mode: returns the token from the isolated console vault', async () => {
    mutableConfig.mode = 'host'
    vi.mocked(getConsoleSessionEntry).mockResolvedValue({
      accessToken: 'tok-1',
      audience: 'console',
      browser: {
        audience: 'console',
        contextId: 'ctx',
        generation: 1,
        familyId: 'family',
        securityVersion: 0,
      },
    } as never)

    const result = await resolveConsoleAccessToken(request())

    expect(result).toMatchObject({
      token: 'tok-1',
      bindingHeaders: { 'x-amcore-browser-audience': 'console' },
    })
    expect(getOptionalSessionEntry).not.toHaveBeenCalled()
  })

  it('path mode: returns the token from the product session', async () => {
    mutableConfig.mode = 'path'
    vi.mocked(getOptionalSessionEntry).mockResolvedValue({
      accessToken: 'tok-2',
      audience: 'product',
      browser: {
        audience: 'product',
        contextId: 'ctx',
        generation: 1,
        familyId: 'family',
        securityVersion: 0,
      },
    } as never)

    const result = await resolveConsoleAccessToken(request())

    expect(result).toMatchObject({
      token: 'tok-2',
      bindingHeaders: { 'x-amcore-browser-audience': 'product' },
    })
    expect(getConsoleSessionEntry).not.toHaveBeenCalled()
  })

  it('returns a 401 failure when there is no session', async () => {
    mutableConfig.mode = 'host'
    vi.mocked(getConsoleSessionEntry).mockResolvedValue(null)

    const result = await resolveConsoleAccessToken(request())

    expect('failure' in result && result.failure.status).toBe(401)
  })

  it('maps a "no session" exception to 401, not 503', async () => {
    mutableConfig.mode = 'host'
    vi.mocked(getConsoleSessionEntry).mockRejectedValue(new SessionNotFoundError('s1'))

    const result = await resolveConsoleAccessToken(request())

    expect('failure' in result && result.failure.status).toBe(401)
  })

  it('maps a vault-unavailable exception to 503 (fail closed, not logged out)', async () => {
    mutableConfig.mode = 'host'
    vi.mocked(getConsoleSessionEntry).mockRejectedValue(
      new SessionVaultUnavailableError(new Error('down'))
    )

    const result = await resolveConsoleAccessToken(request())

    expect('failure' in result && result.failure.status).toBe(503)
  })
})
