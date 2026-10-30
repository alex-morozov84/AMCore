// @vitest-environment node
import type * as Shared from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ mode: 'path' as 'path' | 'host' }))
vi.mock('server-only', () => ({}))
vi.mock('@amcore/shared', async (original) => {
  const actual = await original<typeof Shared>()
  return {
    ...actual,
    get PRODUCT_ADMIN_CONFIG() {
      return { ...actual.PRODUCT_ADMIN_CONFIG, mode: settings.mode }
    },
  }
})

import { accountMfaRoute } from './handlers'

beforeEach(() => {
  settings.mode = 'path'
  vi.stubEnv('FRONTEND_URL', 'https://shop.example')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-test-frontend-context-key-at-least-32>')
})
afterEach(() => vi.unstubAllEnvs())

function request(host: string, method = 'GET', origin?: string) {
  const input = new Request(`https://${host}/api/auth/mfa`, {
    method,
    headers: {
      host,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      cookie: 'amcore_session=<fake-session>; __Host-amcore_staff_session=<fake-staff>',
      authorization: 'Bearer <fake-credential>',
    },
    ...(method === 'POST'
      ? {
          body: JSON.stringify({
            action: 'start_enrollment',
            operationId: '01900000-0000-7000-8000-000000000001',
            flowBinding: '01900000-0000-7000-8000-000000000002',
          }),
        }
      : {}),
  })
  vi.spyOn(input, 'json').mockRejectedValue(new Error('Use only the bounded stream parser'))
  return input
}
function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
}
describe('account MFA BFF without a valid session or continuation', () => {
  it.each(['site', 'admin'] as const)(
    'does not start or reveal a flow through %s',
    async (frontend) => {
      const input = request('shop.example')
      const read = await accountMfaRoute(input, frontend)
      expect(read.status).toBe(401)
      privateResponse(read)
      const command = request('shop.example', 'POST', 'https://shop.example')
      const response = await accountMfaRoute(command, frontend)
      expect(response.status).toBe(401)
      expect(command.json).not.toHaveBeenCalled()
      privateResponse(response)
    }
  )
  it.each([undefined, 'null', 'https://attacker.example'])(
    'rejects mutation origin %s',
    async (origin) => {
      const response = await accountMfaRoute(request('shop.example', 'POST', origin), 'site')
      expect(response.status).toBe(403)
      privateResponse(response)
    }
  )
  it('does not accept a caller-selected staff audience or a site path on the staff host', async () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://office.example')
    expect((await accountMfaRoute(request('office.example'), 'site')).status).toBe(404)
    expect((await accountMfaRoute(request('shop.example'), 'admin')).status).toBe(404)
    const response = await accountMfaRoute(request('office.example'), 'admin')
    expect(response.status).toBe(401)
    privateResponse(response)
    expect(
      (await accountMfaRoute(request('office.example', 'POST', 'https://shop.example'), 'admin'))
        .status
    ).toBe(403)
    expect(
      (await accountMfaRoute(request('office.example', 'POST', 'https://office.example'), 'admin'))
        .status
    ).toBe(401)
  })
})
