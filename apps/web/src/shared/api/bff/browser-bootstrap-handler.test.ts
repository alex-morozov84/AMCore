// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { fetchBackendResponse } from '../backend-transport'

import { createBrowserAuthAttempt } from './browser-auth-attempt'
import { handleBrowserBootstrap } from './browser-bootstrap-handler'
import { productWebRoute } from './product-web-route'

vi.mock('server-only', () => ({}))
vi.mock('../backend-transport', () => ({
  fetchBackendResponse: vi.fn(),
  getBackendBaseUrl: () => 'http://api.test',
}))
vi.mock('./browser-auth-attempt', () => ({
  createBrowserAuthAttempt: vi.fn(),
  readBrowserAuthAttempt: vi.fn(),
  pendingAuthCookie: vi.fn(() => ({ name: 'amcore_pending_auth', options: {} })),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-bootstrap-private-key-at-least-32>')
})
afterEach(() => vi.unstubAllEnvs())

it.each([
  ['75', '75'],
  ['invalid', null],
] as const)(
  'preserves source refusal without allocating an attempt (Retry-After %s)',
  async (delay, expected) => {
    vi.mocked(fetchBackendResponse).mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': delay },
      })
    )
    const request = new Request('https://app.example.test/api/auth/browser-context', {
      method: 'POST',
      headers: {
        host: 'app.example.test',
        origin: 'https://app.example.test',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    const response = await productWebRoute(request, 'site-auth', (context) =>
      handleBrowserBootstrap(request, context)
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe(expected)
    expect(await response.json()).toMatchObject({ errorCode: 'RATE_LIMIT_EXCEEDED' })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(createBrowserAuthAttempt).not.toHaveBeenCalled()
  }
)
