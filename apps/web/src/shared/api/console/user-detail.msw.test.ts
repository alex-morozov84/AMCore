// @vitest-environment node
import { DEFAULT_LOCALE } from '@amcore/shared'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { fetchConsoleUserDetail } from './users'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/server', async () => {
  const { fetchBackend } = await import('../server/backend-fetch')
  return { fetchBackend }
})
vi.mock('../server/access-token', () => ({ getBackendAccessToken: async () => null }))
vi.mock('../bff/trusted-client-ip', () => ({ resolveTrustedClientIp: () => null }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('./access-token', () => ({ getConsoleAwareAccessToken: async () => 'test-console-token' }))

const endpoint = `${process.env.API_URL ?? 'http://localhost:5002'}/api/v1/admin/users/target`
const server = setupServer()
const user = {
  id: 'target',
  email: 'target@example.test',
  name: null,
  avatarUrl: null,
  phone: null,
  emailVerified: false,
  systemRole: 'USER',
  locale: DEFAULT_LOCALE,
  timezone: 'UTC',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
}
const response = {
  user,
  membershipCount: 0,
  memberships: { data: [], total: 0, page: 1, limit: 20 },
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('accepts explicit neutral facts through the real HTTP/schema boundary', async () => {
  const data = { ...response, loginDiagnostics: { hasPassword: false, linkedProviders: [] } }
  server.use(
    http.get(endpoint, ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer test-console-token')
      return HttpResponse.json(data)
    })
  )
  expect(await fetchConsoleUserDetail('target', 1)).toEqual({ status: 'success', data })
})

it.each([
  undefined,
  { hasPassword: 'false', linkedProviders: [] },
  { hasPassword: true, linkedProviders: ['unknown'] },
  { hasPassword: false, linkedProviders: [], passwordHash: '<canary>' },
])(
  'rejects missing or invalid diagnostics instead of inventing absence: %j',
  async (loginDiagnostics) => {
    server.use(http.get(endpoint, () => HttpResponse.json({ ...response, loginDiagnostics })))
    await expect(fetchConsoleUserDetail('target', 1)).rejects.toMatchObject({
      kind: 'invalid-payload',
    })
  }
)

it.each([500, 503])(
  'keeps HTTP %i distinct from an empty setup and recovers on retry',
  async (status) => {
    server.use(http.get(endpoint, () => new HttpResponse(null, { status })))
    expect(await fetchConsoleUserDetail('target', 1)).toMatchObject({
      status: 'unavailable',
      reason: 'upstream',
    })
    const data = {
      ...response,
      loginDiagnostics: { hasPassword: true, linkedProviders: ['google'] },
    }
    server.use(http.get(endpoint, () => HttpResponse.json(data)))
    expect(await fetchConsoleUserDetail('target', 1)).toEqual({ status: 'success', data })
  }
)

it('preserves a real not-found response', async () => {
  server.use(http.get(endpoint, () => new HttpResponse(null, { status: 404 })))
  expect(await fetchConsoleUserDetail('target', 1)).toEqual({ status: 'not-found' })
})
