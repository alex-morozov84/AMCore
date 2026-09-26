// @vitest-environment node
import type * as ReactModule from 'react'
import { cookies, headers } from 'next/headers'
import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { proxyToBackend } from './authenticated-proxy'
import { getOptionalSessionEntry } from './dal'
import { fakeVaultEntry } from './dal.test-helpers'
import { handleGetSessions } from './sessions-handler'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('react', async (original) => ({
  ...(await original<typeof ReactModule>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }))
vi.mock('./session-vault-store', () => ({ redisVaultStore: {} }))
vi.mock('./session-lock', () => ({ redisVaultLock: {} }))
// Execute the real request-bound transport handed to the protocol. Protocol's
// locking/error behavior is covered separately by ensure-fresh-session tests.
vi.mock('./ensure-fresh-session', () => ({
  ensureFreshSession: async (
    _id: string,
    deps: { upstreamRefresh: (token: string, signal: AbortSignal) => Promise<unknown> }
  ) => {
    await deps.upstreamRefresh('vault-credential', new AbortController().signal)
    return fakeVaultEntry()
  },
}))

beforeEach(() => {
  vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip')
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'vault-id' }) } as never)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each(['product DAL', 'authenticated proxy', 'own sessions'])(
  '%s refresh supplies current visitor headers',
  async (caller) => {
    const source = new Headers({
      'user-agent': caller,
      'x-real-ip': '8.8.8.8',
      [AMCORE_CLIENT_IP_HEADER]: '1.1.1.1',
    })
    vi.mocked(headers).mockResolvedValue(source as never)
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).endsWith('/auth/refresh')
        ? new Response(JSON.stringify({ accessToken: 'rotated' }), {
            headers: { 'set-cookie': 'refresh_token=next; Path=/' },
          })
        : new Response('{}')
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('http://web/api/auth/sessions', { headers: source })
    if (caller === 'product DAL') await getOptionalSessionEntry()
    else if (caller === 'authenticated proxy') await proxyToBackend(request, ['users', 'me'])
    else await handleGetSessions(request)
    const refresh = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/refresh'))
    expect(refresh).toBeDefined()
    const forwarded = new Headers((refresh![1] as RequestInit).headers)
    expect(forwarded.get('user-agent')).toBe(caller)
    expect(forwarded.get(AMCORE_CLIENT_IP_HEADER)).toBe('8.8.8.8')
    expect(forwarded.get('cookie')).toBe('refresh_token=vault-credential')
  }
)
