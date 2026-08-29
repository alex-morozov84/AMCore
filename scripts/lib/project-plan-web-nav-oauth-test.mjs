// init:project --mode=single: oauth-exchange-handler.test.ts, kept in sync
// with project-plan-web-nav-oauth.mjs's rewrite of handleOAuthExchange's
// signature. Found via the real `pnpm --filter web build` in
// init-project.test.mjs, not named in the original scope. Locale-independent
// (every assertion becomes `/login` or `/`, never the chosen locale itself),
// so one fixed AFTER covers both --locale=en and --locale=ru.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `// @vitest-environment node
import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mintSession } from './mint-session'
import { handleOAuthExchange } from './oauth-exchange-handler'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
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
vi.mock('./mint-session', () => ({
  mintSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
}))

function mockRefreshCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

function makeRequest(pathAndQuery: string): Request {
  return new Request(\`http://next.internal/\${pathAndQuery}\`)
}

beforeEach(() => {
  vi.clearAllMocks()
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
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
    vi.mocked(fetchCurrentUser).mockResolvedValue(null)

    const response = await handleOAuthExchange(makeRequest('en/auth/callback?ticket=t1'), 'en')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/en/login')
  })

  it('redirects, clears the temp cookie, and never sets amcore_session when mintSession throws (e.g. Redis down)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
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
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)

    const response = await handleOAuthExchange(makeRequest('ru/auth/callback?ticket=t1'), 'ru')

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/ru')
    expect(response.cookies.get('amcore_session')?.value).toBe('sess-1')
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })
})
`

const AFTER = `// @vitest-environment node
import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mintSession } from './mint-session'
import { handleOAuthExchange } from './oauth-exchange-handler'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
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
vi.mock('./mint-session', () => ({
  mintSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
}))

function mockRefreshCookie(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn().mockReturnValue(value ? { value } : undefined),
  } as never)
}

function makeRequest(pathAndQuery: string): Request {
  return new Request(\`http://next.internal/\${pathAndQuery}\`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleOAuthExchange — failure paths redirect to login with an error code, never throw', () => {
  it('redirects when the ticket query param is missing', async () => {
    mockRefreshCookie('rt-1')

    const response = await handleOAuthExchange(makeRequest('auth/callback'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('oauthError')).toBe(AuthErrorCode.OAUTH_TICKET_INVALID)
    expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
  })

  it('redirects when the temporary refresh_token cookie is missing', async () => {
    mockRefreshCookie(undefined)

    const response = await handleOAuthExchange(makeRequest('auth/callback?ticket=t1'))

    expect(response.status).toBe(307)
    expect(callUpstreamOAuthExchange).not.toHaveBeenCalled()
  })

  it('redirects and clears the temp cookie when the exchange call fails', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockRejectedValue(new UpstreamOAuthError(401, {}))

    const response = await handleOAuthExchange(makeRequest('auth/callback?ticket=t1'))

    expect(response.status).toBe(307)
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })

  it('redirects when fetchCurrentUser returns null (profile lookup found no user)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
    vi.mocked(fetchCurrentUser).mockResolvedValue(null)

    const response = await handleOAuthExchange(makeRequest('auth/callback?ticket=t1'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/login')
  })

  it('redirects, clears the temp cookie, and never sets amcore_session when mintSession throws (e.g. Redis down)', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)
    vi.mocked(mintSession).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const response = await handleOAuthExchange(makeRequest('auth/callback?ticket=t1'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('oauthError')).toBe(AuthErrorCode.OAUTH_TICKET_INVALID)
    expect(response.cookies.get('refresh_token')?.value).toBe('')
    expect(response.cookies.get('amcore_session')).toBeUndefined()
  })
})

describe('handleOAuthExchange — success', () => {
  it('mints a session, sets amcore_session, clears the temp refresh_token cookie, and redirects home', async () => {
    mockRefreshCookie('rt-1')
    vi.mocked(callUpstreamOAuthExchange).mockResolvedValue('at-1')
    vi.mocked(fetchCurrentUser).mockResolvedValue({ id: 'u1' } as never)

    const response = await handleOAuthExchange(makeRequest('auth/callback?ticket=t1'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/')
    expect(response.cookies.get('amcore_session')?.value).toBe('sess-1')
    expect(response.cookies.get('refresh_token')?.value).toBe('')
  })
})
`

export function buildWebNavOauthTestSteps(root) {
  return [
    exactContentStep(
      path.join(root, 'apps/web/src/shared/api/bff/oauth-exchange-handler.test.ts'),
      { expectedBefore: BEFORE, after: AFTER },
      'oauth-exchange-handler.test.ts: drop the locale argument and its path segment from every call'
    ),
  ]
}
