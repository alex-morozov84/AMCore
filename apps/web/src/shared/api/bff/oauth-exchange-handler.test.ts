// @vitest-environment node
import { cookies } from 'next/headers'
import { AuthErrorCode, DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishInvitedOAuth } from './invitation-oauth-exchange'
import { recoverPublishedInvitedOAuth } from './invitation-oauth-recovery'
import { mintSession } from './mint-session'
import { handleOAuthExchange } from './oauth-exchange-handler'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))
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
  vi.mocked(recoverPublishedInvitedOAuth).mockResolvedValue(null)
})

describe('handleOAuthExchange — failure paths redirect to login with an error code, never throw', () => {
  it('redirects when the ticket query param is missing', async () => {
    mockRefreshCookie('rt-1')

    const response = await handleOAuthExchange(makeRequest('en/auth/callback'), 'en')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/en/login')
    expect(location.searchParams.get('oauthError')).toBe(AuthErrorCode.OAUTH_TICKET_INVALID)
    expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
  })

  it('redirects when the temporary refresh_token cookie is missing', async () => {
    mockRefreshCookie(undefined)

    const response = await handleOAuthExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(307)
    expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
  })

  it('redirects and clears the temp cookie when the exchange call fails', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockRejectedValue(new UpstreamOAuthError(401, {}))

    const response = await handleOAuthExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(307)
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })

  it('redirects when fetchCurrentUser returns null (profile lookup found no user)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' })
    vi.mocked(fetchCurrentUser).mockResolvedValue(null)

    const response = await handleOAuthExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/en/login')
  })

  it('redirects, clears the temp cookie, and never sets amcore_session when mintSession throws (e.g. Redis down)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue({ accessToken: 'at-1' })
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(mintSession).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const response = await handleOAuthExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/en/login')
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

    const response = await handleOAuthExchange(makeRequest('ru/auth/callback?ticket=t1'), 'ru')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/ru')
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
      const response = await handleOAuthExchange(
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
