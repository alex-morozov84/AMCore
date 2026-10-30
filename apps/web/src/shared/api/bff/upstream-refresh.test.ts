// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUpstreamRefresh as createBoundRefresh } from './upstream-refresh'
const browser = {
  contextId: '62dde074-27ae-42fb-a7c3-229c32566d57',
  generation: 3,
  familyId: 'family-1',
  securityVersion: 2,
  audience: 'product' as const,
}
function createUpstreamRefresh(source: Headers) {
  source = new Headers(source)
  source.set('cookie', `amcore_browser_context=${'a'.repeat(43)}`)
  const refresh = createBoundRefresh(source)
  return (token: string, signal: AbortSignal) => refresh(token, signal, browser)
}
const upstreamRefresh = createUpstreamRefresh(new Headers())

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

function fakeResponse(options: {
  ok: boolean
  status: number
  body: unknown
  setCookieHeaders?: string[]
}) {
  return {
    ok: options.ok,
    status: options.status,
    json: async () => options.body,
    headers: { getSetCookie: () => options.setCookieHeaders ?? [] },
  } as unknown as Response
}

beforeEach(() => {
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', 'test-key-'.repeat(8))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('upstreamRefresh', () => {
  it('refuses missing browser authority before sending any refresh', async () => {
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    await expect(
      createBoundRefresh(new Headers())('rt', new AbortController().signal)
    ).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['AUTH_CONTEXT_CHANGED', 'SESSION_CHANGED'])(
    'keeps %s terminal instead of retryable refresh',
    async (errorCode) => {
      const send = vi
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 409, body: { errorCode } }))
      vi.stubGlobal('fetch', send)
      await expect(upstreamRefresh('rt', new AbortController().signal)).rejects.toMatchObject({
        status: 401,
        errorCode: 'AUTH_CONTEXT_CHANGED',
      })
      expect(send).toHaveBeenCalledOnce()
    }
  )

  it('presents the refresh token as a Cookie header and returns the rotated pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: { accessToken: 'at-new' },
        setCookieHeaders: ['refresh_token=rt-new; Path=/; HttpOnly'],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await upstreamRefresh('rt-old', new AbortController().signal)

    expect(result.accessToken).toBe('at-new')
    expect(result.refreshToken).toBe('rt-new')
    expect(result.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('cookie')).toBe('refresh_token=rt-old')
    expect(headers.get('x-amcore-browser-context')).toBe(browser.contextId)
    expect(headers.get('x-amcore-browser-generation')).toBe('3')
    expect(headers.get('x-amcore-browser-binding')).toBe('a'.repeat(43))
  })

  it('snapshots the original edge source together with UA before a refresh waits for its lock', async () => {
    vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip')
    const source = new Headers({ 'x-real-ip': '203.0.113.75', 'user-agent': 'original device' })
    const refresh = createUpstreamRefresh(source)
    source.set('x-real-ip', '9.9.9.9')
    source.set('user-agent', 'later device')
    const send = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: { accessToken: 'at' },
        setCookieHeaders: ['refresh_token=rt; Path=/; HttpOnly'],
      })
    )
    vi.stubGlobal('fetch', send)
    await refresh('old', new AbortController().signal)
    const headers = new Headers(send.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-amcore-client-ip')).toBe('203.0.113.75')
    expect(headers.get('user-agent')).toBe('original device')
  })
  it('maps a 401 to code "invalid" (the backend collapses expired/invalid/reused)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 401, body: {} }))
    )

    await expect(upstreamRefresh('rt-old', new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('maps a 5xx to code "network" (transient, must not delete the vault)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 503, body: {} }))
    )

    await expect(upstreamRefresh('rt-old', new AbortController().signal)).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('maps a fetch rejection to code "network" without exposing its message', async () => {
    const cause = new TypeError('connect ECONNREFUSED secret-host')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))

    const rejection = upstreamRefresh('rt-old', new AbortController().signal)
    await expect(rejection).rejects.toMatchObject({
      message: 'Upstream refresh request failed',
      code: 'network',
      cause,
    })
  })

  it('maps an aborted refresh request to code "timeout"', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(controller.signal.reason))

    await expect(upstreamRefresh('rt-old', controller.signal)).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('treats a missing rotated refresh_token cookie as code "invalid"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 200,
          body: { accessToken: 'at-new' },
          setCookieHeaders: [],
        })
      )
    )

    await expect(upstreamRefresh('rt-old', new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid',
    })
  })
})
