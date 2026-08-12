// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { upstreamRefresh } from './upstream-refresh'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('upstreamRefresh', () => {
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
    expect((init.headers as Record<string, string>).Cookie).toBe('refresh_token=rt-old')
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
