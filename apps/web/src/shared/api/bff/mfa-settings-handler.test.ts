// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../backend-transport', () => ({
  fetchBackendResponse: vi.fn(),
  getBackendBaseUrl: () => 'http://api.test',
}))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./mfa-settings-start-receipt', () => ({
  settingsStartReceipt: vi.fn(async (_request, _context, _source, _command, upstream) =>
    upstream('settings-start', {})
  ),
}))

import { fetchBackendResponse } from '../backend-transport'

import { authFailureResponse } from './auth-failure-response'
import { ensureFreshSession } from './ensure-fresh-session'
import { startMfaSettings } from './mfa-settings-handler'
import { resolveProductWebContext } from './product-web-context.server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
it('preserves the HTTP429 code and Retry-After at the public error boundary', async () => {
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-settings-context-key-at-least-32>')
  const request = new Request('https://app.example.test/api/auth/mfa', {
    headers: {
      host: 'app.example.test',
      cookie: `amcore_session=${'a'.repeat(43)}; amcore_browser_context=${'b'.repeat(43)}`,
    },
  })
  vi.mocked(ensureFreshSession).mockResolvedValue({
    accessToken: '<fake-access>',
    audience: 'product',
    userSnapshot: { email: 'fixture@example.test' },
    browser: {
      contextId: 'context-A',
      generation: 1,
      familyId: 'family-A',
      securityVersion: 1,
      audience: 'product',
    },
  } as never)
  vi.mocked(fetchBackendResponse).mockResolvedValue(
    new Response(null, { status: 429, headers: { 'retry-after': '37' } })
  )
  const work = startMfaSettings(request, resolveProductWebContext(request.headers, 'site-auth'), {
    action: 'start_code_rotation',
    operationId: crypto.randomUUID(),
  })
  const response = await work.catch((error) => authFailureResponse(request, error))
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('37')
  expect(await response.json()).toMatchObject({ errorCode: 'RATE_LIMIT_EXCEEDED' })
  expect(response.headers.get('set-cookie')).toBeNull()
})
