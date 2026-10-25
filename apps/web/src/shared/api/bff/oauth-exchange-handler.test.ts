// @vitest-environment node
import { cookies } from 'next/headers'
import {
  AuthErrorCode,
  coerceSupportedLocale,
  DEFAULT_LOCALE,
  localizedFrontendUrl,
} from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { revokeBackendSession } from './backend-session-revocation'
import { publishInvitedOAuth } from './invitation-oauth-exchange'
import { recoverPublishedInvitedOAuth } from './invitation-oauth-recovery'
import { mintSession } from './mint-session'
import { handleOAuthExchange } from './oauth-exchange-handler'
import { resolveProductWebContext } from './product-web-context.server'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))
vi.mock('./backend-session-revocation', () => ({ revokeBackendSession: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn(async () => new Headers()) }))
vi.mock('./upstream-oauth', () => ({
  callUpstreamOAuthExchange: vi.fn(),
  fetchCurrentUser: vi.fn(),
  UpstreamOAuthError: class UpstreamOAuthError extends Error {
    constructor(
      public status: number,
      public body: unknown
    ) {
      super('upstream oauth error')
    }
  },
}))
vi.mock('./invitation-oauth-exchange', () => ({ publishInvitedOAuth: vi.fn() }))
vi.mock('./invitation-oauth-recovery', () => ({ recoverPublishedInvitedOAuth: vi.fn() }))
vi.mock('./mint-session', () => ({
  mintSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
}))

function mockRefreshCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

function makeRequest(pathAndQuery: string): Request {
  return new Request(`http://next.internal/${pathAndQuery}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-test-context-key-with-at-least-32>')
  vi.mocked(recoverPublishedInvitedOAuth).mockResolvedValue(null)
})

afterEach(() => vi.unstubAllEnvs())

async function runExchange(request: Request, locale: string) {
  request.headers.set('host', 'app.example.test')
  const context = resolveProductWebContext(new Headers({ host: 'app.example.test' }), 'site-auth')
  return handleOAuthExchange(
    request,
    {
      ticket: new URL(request.url).searchParams.get('ticket')!,
      locale: coerceSupportedLocale(locale),
    },
    context
  )
}

describe('handleOAuthExchange — failure paths redirect to login with an error code, never throw', () => {
  it.each(['read-failure', 'absent-user', 'mint-failure'])(
    'threads original source into %s compensation',
    async (branch) => {
      mockRefreshCookie('rt-1')
      vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' } as never)
      if (branch === 'read-failure')
        vi.mocked(fetchCurrentUser).mockRejectedValueOnce(new Error('read'))
      else
        vi.mocked(fetchCurrentUser).mockResolvedValue(
          branch === 'absent-user' ? (null as never) : ({ id: 'u1' } as never)
        )
      if (branch === 'mint-failure') vi.mocked(mintSession).mockRejectedValueOnce(new Error('mint'))
      const request = makeRequest('en/auth/callback?ticket=t1')
      request.headers.set('x-real-ip', '203.0.113.75')
      await runExchange(request, 'en')
      expect(revokeBackendSession).toHaveBeenCalledWith('rt-1', request.headers)
    }
  )
  it('redirects when the temporary refresh_token cookie is missing', async () => {
    mockRefreshCookie(undefined)

    const response = await runExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(303)
    expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
  })

  it('redirects and clears the temp cookie when the exchange call fails', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockRejectedValue(new UpstreamOAuthError(401, {}))

    const response = await runExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(303)
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })

  it('redirects when fetchCurrentUser returns null (profile lookup found no user)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' })
    vi.mocked(fetchCurrentUser).mockResolvedValue(null)

    const response = await runExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe(
      new URL(
        localizedFrontendUrl('https://app.example.test', coerceSupportedLocale('en'), '/login')
      ).pathname
    )
  })

  it('redirects, clears the temp cookie, and never sets amcore_session when mintSession throws (e.g. Redis down)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' })
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(mintSession).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const response = await runExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe(
      new URL(
        localizedFrontendUrl('https://app.example.test', coerceSupportedLocale('en'), '/login')
      ).pathname
    )
    expect(location.searchParams.get('oauthError')).toBe(AuthErrorCode.OAUTH_TICKET_INVALID)
    expect(response.cookies.get('refresh_token')?.value).toBe('')
    expect(response.cookies.get('amcore_session')).toBeUndefined()
  })
})

describe('handleOAuthExchange — success', () => {
  it('mints a session, sets amcore_session, clears the temp refresh_token cookie, and redirects home', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' })
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)

    const response = await runExchange(makeRequest('ru/auth/callback?ticket=t1'), 'ru')

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe(
      new URL(localizedFrontendUrl('https://app.example.test', coerceSupportedLocale('ru')))
        .pathname
    )
    expect(response.cookies.get('amcore_session')?.value).toBe('sess-1')
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })
})

for (const recovered of [true, false]) {
  it(`preserves the project locale in invited OAuth ${recovered ? 'recovery' : 'publication'}`, async () => {
    const origin = 'https://app.example.test'
    const flowId = 'f'.repeat(22)
    vi.stubEnv('WEB_TRUSTED_ORIGINS', origin)
    try {
      mockRefreshCookie('rt-1')
      if (recovered) {
        vi.mocked(recoverPublishedInvitedOAuth).mockResolvedValue({
          locale: DEFAULT_LOCALE,
          flowId,
        })
      } else {
        vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({
          accessToken: 'at-1',
          invitation: {},
        } as never)
        vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)
        vi.mocked(publishInvitedOAuth).mockResolvedValue({
          locale: DEFAULT_LOCALE,
          flowId,
          sessionId: 'sess-invited',
        } as never)
      }
      const response = await runExchange(
        new Request(`${origin}/auth/callback?ticket=t1`),
        DEFAULT_LOCALE
      )
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(
        localizedFrontendUrl(origin, DEFAULT_LOCALE, `invite/flow/${flowId}`)
      )
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.cookies.get('refresh_token')?.value).toBe('')
      if (recovered) expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
      else expect(response.cookies.get('amcore_session')?.value).toBe('sess-invited')
    } finally {
      vi.unstubAllEnvs()
    }
  })
}
