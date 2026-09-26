// @vitest-environment node
import type * as ReactModule from 'react'
import { cookies, headers } from 'next/headers'
import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'
import { afterEach, expect, it, vi } from 'vitest'

import { fakeVaultEntry } from '@/shared/api/bff/dal.test-helpers'

import { getConsoleSessionEntry } from './session'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('react', async (original) => ({
  ...(await original<typeof ReactModule>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('./session-vault-store', () => ({ redisConsoleVaultStore: {} }))
vi.mock('./session-lock', () => ({ redisConsoleVaultLock: {} }))
vi.mock('@/shared/api/bff/ensure-fresh-session', () => ({
  ensureFreshSession: async (
    _id: string,
    deps: { upstreamRefresh: (token: string, signal: AbortSignal) => Promise<unknown> }
  ) => {
    await deps.upstreamRefresh('vault-credential', new AbortController().signal)
    return { ...fakeVaultEntry(), audience: 'console' }
  },
}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('console helper refresh supplies current visitor headers with vault-derived credentials', async () => {
  vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip')
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'vault-id' }) } as never)
  vi.mocked(headers).mockResolvedValue(
    new Headers({
      'user-agent': 'console helper',
      'x-real-ip': '8.8.8.8',
      [AMCORE_CLIENT_IP_HEADER]: '1.1.1.1',
    }) as never
  )
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ accessToken: 'rotated' }), {
        headers: { 'set-cookie': 'refresh_token=next; Path=/' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  await getConsoleSessionEntry()
  expect(fetchMock).toHaveBeenCalledOnce()
  const forwarded = new Headers(fetchMock.mock.calls[0][1]?.headers)
  expect(forwarded.get('user-agent')).toBe('console helper')
  expect(forwarded.get(AMCORE_CLIENT_IP_HEADER)).toBe('8.8.8.8')
  expect(forwarded.get('cookie')).toBe('refresh_token=vault-credential')
})
