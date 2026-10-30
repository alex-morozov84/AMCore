// @vitest-environment node
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./authenticated-proxy', () => ({
  resolveConsoleAccessToken: vi.fn(),
  isConsoleRequestOriginTrusted: vi.fn(),
}))
import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'
import { handleSupportMail } from './support-mail'

const server = setupServer()
const id = '00000000-0000-4000-8000-000000000001'
const attempt = '00000000-0000-4000-8000-000000000002'
const post = (body: unknown) =>
  new Request('https://console.example.test/api/users/user/support-mail', {
    method: 'POST',
    headers: {
      origin: 'https://console.example.test',
      cookie: 'browser-secret=hidden',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
const get = () => new Request('https://console.example.test/api/users/user/support-mail')

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveConsoleAccessToken).mockResolvedValue({
    token: 'server-only-access',
    bindingHeaders: {},
  })
  vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(true)
})

describe('fixed support-mail BFF contracts', () => {
  it.each([
    ['status', 'GET', ''],
    ['prepare', 'POST', '/prepare'],
    ['send', 'POST', `/${attempt}/send`],
    ['receipt', 'GET', `/${attempt}`],
  ] as const)(
    'forwards only the fixed %s route without browser credentials',
    async (operation, method, suffix) => {
      let calls = 0
      server.use(
        http.all(
          `http://localhost:5002/api/v1/admin/users/${id}/support-mail${suffix}`,
          async ({ request }) => {
            calls++
            expect(request.method).toBe(method)
            expect(request.headers.get('authorization')).toBe('Bearer server-only-access')
            // MSW's test cookie jar can add its own prior upstream cookie.
            expect(request.headers.get('cookie') ?? '').not.toContain('browser-secret')
            if (method === 'POST')
              expect(await request.json()).toEqual(
                operation === 'prepare' ? { kind: 'password_recovery' } : {}
              )
            return HttpResponse.json(
              { safe: true },
              { headers: { 'set-cookie': 'upstream=hidden' } }
            )
          }
        )
      )
      const response = await handleSupportMail(
        method === 'POST'
          ? post(operation === 'prepare' ? { kind: 'password_recovery' } : {})
          : get(),
        id,
        operation,
        attempt
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(await response.json()).toEqual({ safe: true })
      expect(calls).toBe(1)
    }
  )

  it('rejects recipient changes, arbitrary paths, excess body and untrusted origins before resolving credentials', async () => {
    for (const body of [
      { kind: 'password_recovery', recipient: 'other@example.com' },
      { kind: 'unknown' },
      {},
      null,
    ])
      expect((await handleSupportMail(post(body), id, 'prepare')).status).toBe(400)
    expect(
      (await handleSupportMail(post({ url: 'https://elsewhere.test' }), id, 'send', attempt)).status
    ).toBe(400)
    expect((await handleSupportMail(get(), '../x', 'status')).status).toBe(400)
    expect((await handleSupportMail(get(), id, 'receipt', '../x')).status).toBe(400)
    expect((await handleSupportMail(post({ kind: 'x'.repeat(9000) }), id, 'prepare')).status).toBe(
      413
    )
    vi.mocked(isConsoleRequestOriginTrusted).mockReturnValue(false)
    expect((await handleSupportMail(post({}), id, 'send', attempt)).status).toBe(403)
    expect(resolveConsoleAccessToken).not.toHaveBeenCalled()
  })

  it('does not retry a failed transport or expose its error', async () => {
    let calls = 0
    server.use(
      http.post(
        `http://localhost:5002/api/v1/admin/users/${id}/support-mail/${attempt}/send`,
        () => {
          calls++
          return HttpResponse.error()
        }
      )
    )
    const response = await handleSupportMail(post({}), id, 'send', attempt)
    expect(response.status).toBe(503)
    expect(calls).toBe(1)
    expect(await response.text()).not.toContain('server-only-access')
  })
})
