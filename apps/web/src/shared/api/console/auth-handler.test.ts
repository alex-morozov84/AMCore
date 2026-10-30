// @vitest-environment node
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedConsoleOrigin: vi.fn() }))
vi.mock('@/shared/api/bff/browser-login-handler', () => ({ handleBrowserPassword: vi.fn() }))

import { handleBrowserPassword } from '@/shared/api/bff/browser-login-handler'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { handleConsoleLogin } from './auth-handler'
import { consoleBrowserContext } from './browser-context'
import { isTrustedConsoleOrigin } from './origin-guard'

const config = ADMIN_CONSOLE_CONFIG as { mode: 'path' | 'host' }
const original = config.mode
function request(path = '/api/console/auth/login', host = 'console.example.test') {
  return new Request(`https://${host}${path}`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', origin: `https://${host}` },
    body: JSON.stringify({ email: 'operator@example.test', password: '<fake-password>' }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  config.mode = 'host'
  vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', 'console.example.test')
  vi.stubEnv('ADMIN_CONSOLE_ORIGIN', 'https://console.example.test')
  vi.stubEnv('FRONTEND_URL', 'https://shop.example.test')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-console-private-context-key-at-least-32>')
  vi.mocked(isTrustedConsoleOrigin).mockReturnValue(true)
  vi.mocked(handleBrowserPassword).mockResolvedValue(
    NextResponse.json(
      { kind: 'mfa', flowBinding: '01900000-0000-7000-8000-000000000001' },
      { status: 202 }
    )
  )
})
afterEach(() => {
  config.mode = original
  vi.unstubAllEnvs()
})

describe('Console login shares exact-attempt browser publication', () => {
  it.each(['path', 'wrong-host'] as const)(
    'rejects %s before reading credentials',
    async (kind) => {
      if (kind === 'path') config.mode = 'path'
      const response = await handleConsoleLogin(
        request(undefined, kind === 'wrong-host' ? 'shop.example.test' : undefined)
      )
      expect(response.status).toBe(404)
      expect(handleBrowserPassword).not.toHaveBeenCalled()
    }
  )
  it('rejects an untrusted origin before starting a flow', async () => {
    vi.mocked(isTrustedConsoleOrigin).mockReturnValue(false)
    expect((await handleConsoleLogin(request())).status).toBe(403)
    expect(handleBrowserPassword).not.toHaveBeenCalled()
  })
  it('returns restricted MFA unchanged and selects only the console cookie and namespace', async () => {
    const incoming = request(),
      response = await handleConsoleLogin(incoming)
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ kind: 'mfa' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(handleBrowserPassword).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        audience: 'console',
        namespace: 'web:console-session:v1',
        cookieName: '__Host-amcore_console_session',
        origin: 'https://console.example.test',
        cookieOptions: expect.objectContaining({ secure: true, httpOnly: true, path: '/' }),
      }),
      { email: 'operator@example.test', password: '<fake-password>' }
    )
    expect(consoleBrowserContext(incoming).apiHeaders).toEqual({})
  })
  it('refuses unexpected query and never starts another issuer', async () => {
    expect(
      (await handleConsoleLogin(request('/api/console/auth/login?familyId=other'))).status
    ).toBe(400)
    expect(handleBrowserPassword).not.toHaveBeenCalled()
  })
  it('fails closed without emitting a cookie when publication is unavailable', async () => {
    vi.mocked(handleBrowserPassword).mockRejectedValueOnce(new Error('storage unavailable'))
    const response = await handleConsoleLogin(request())
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
