// @vitest-environment node
import { BROWSER_AUTH_HEADERS } from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  browserAnchorCookie,
  browserSessionHeaders,
  createBrowserBindingVerifier,
} from './browser-binding.server'
import { makeEntry } from './test-fakes'

vi.mock('server-only', () => ({}))

const anchor = 'a'.repeat(43)
const source = () =>
  new Headers({
    cookie: `amcore_browser_context=${anchor}`,
    authorization: 'Bearer forged',
    'x-amcore-browser-audience': 'console',
  })
const entry = () =>
  makeEntry({
    userSnapshot: { ...makeEntry().userSnapshot, id: 'user-A' },
    audience: 'product',
    refreshToken: '1'.repeat(64),
    browser: {
      audience: 'product',
      contextId: 'context-A',
      generation: 3,
      familyId: 'family-A',
      securityVersion: 2,
    },
  })
const current = () => ({ status: 'current', userId: entry().userSnapshot.id, ...entry().browser })
beforeEach(() =>
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-binding-unit-private-transport-key-at-least-32>')
)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Primary browser-vault binding verification', () => {
  it('probes an expired access token using only the actual anchor and vaulted refresh proof', async () => {
    const send = vi.fn().mockResolvedValue(Response.json(current()))
    vi.stubGlobal('fetch', send)
    const old = entry()
    old.accessTokenExpiresAt = 0
    await createBrowserBindingVerifier(source(), 'product')(old)
    const [url, init] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/browser-publications/probe')
    const headers = new Headers(init.headers)
    expect(headers.get(BROWSER_AUTH_HEADERS.binding)).toBe(anchor)
    expect(headers.get(BROWSER_AUTH_HEADERS.audience)).toBe('product')
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
    expect(JSON.parse(init.body as string)).toEqual({
      refreshToken: old.refreshToken,
      familyId: 'family-A',
      securityVersion: 2,
    })
  })

  it.each([
    'missing-anchor',
    'duplicate-anchor',
    'legacy',
    'wrong-audience',
    'wrong-user',
  ] as const)('refuses %s without adopting the currently published account', async (failure) => {
    const send = vi.fn().mockResolvedValue(
      Response.json({
        ...current(),
        userId: failure === 'wrong-user' ? 'other-user' : current().userId,
      })
    )
    vi.stubGlobal('fetch', send)
    const headers = source(),
      vault = entry()
    if (failure === 'missing-anchor') headers.delete('cookie')
    if (failure === 'duplicate-anchor')
      headers.set('cookie', `amcore_browser_context=${anchor}; amcore_browser_context=${anchor}`)
    if (failure === 'legacy') delete vault.browser
    if (failure === 'wrong-audience') vault.audience = 'staff'
    await expect(createBrowserBindingVerifier(headers, 'product')(vault)).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    expect(send).toHaveBeenCalledTimes(failure === 'wrong-user' ? 1 : 0)
  })

  it.each([401, 403, 409, 503] as const)(
    'maps primary status %s without a cached identity fallback',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status })))
      await expect(
        createBrowserBindingVerifier(source(), 'product')(entry())
      ).rejects.toMatchObject({ status: status === 503 ? 503 : 401 })
    }
  )

  it('preserves a known rate refusal and Retry-After without accepting or refreshing authority', async () => {
    const send = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '3' },
      })
    )
    vi.stubGlobal('fetch', send)
    const vault = entry()
    await expect(createBrowserBindingVerifier(source(), 'product')(vault)).rejects.toMatchObject({
      status: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 3,
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(String(send.mock.calls[0]![0])).toContain('/browser-publications/probe')
    expect(vault.browser).toEqual(entry().browser)
  })

  it('fails closed on unavailable or malformed primary verification', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('fake-transport-detail'))
      .mockResolvedValueOnce(Response.json({ status: 'current' }))
    vi.stubGlobal('fetch', send)
    const verify = createBrowserBindingVerifier(source(), 'product')
    await expect(verify(entry())).rejects.toMatchObject({ status: 503 })
    await expect(verify(entry())).rejects.toMatchObject({ status: 503 })
  })

  describe('deadline and cancellation (T082)', () => {
    it('dispatches nothing and refuses when no budget is left', async () => {
      const send = vi.fn()
      vi.stubGlobal('fetch', send)
      await expect(
        createBrowserBindingVerifier(source(), 'product')(entry(), { deadlineMs: 0 })
      ).rejects.toMatchObject({ status: 503, errorCode: 'SERVICE_UNAVAILABLE' })
      expect(send).not.toHaveBeenCalled()
    })

    it('dispatches nothing when the owner already gave up', async () => {
      const send = vi.fn()
      vi.stubGlobal('fetch', send)
      const stopped = new AbortController()
      stopped.abort()
      await expect(
        createBrowserBindingVerifier(source(), 'product')(entry(), { signal: stopped.signal })
      ).rejects.toMatchObject({ status: 503 })
      expect(send).not.toHaveBeenCalled()
    })

    it.each([
      ['a short budget', 400, 400],
      ['no budget named', undefined, 10_000],
      ['a budget above the ceiling', 60_000, 10_000],
    ])(
      'waits at most the smaller of the budget and ten seconds: %s',
      async (_n, budget, expectedMs) => {
        // The native timeout signal is not driven by fake timers; its argument is the contract.
        const timeout = vi.spyOn(AbortSignal, 'timeout')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(current())))
        await createBrowserBindingVerifier(source(), 'product')(entry(), { deadlineMs: budget })
        expect(timeout).toHaveBeenCalledWith(expectedMs)
        timeout.mockRestore()
      }
    )

    it('hands fetch one signal that also covers reading the reply', async () => {
      let seen!: AbortSignal
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          seen = init.signal as AbortSignal
          return Response.json(current())
        })
      )
      await createBrowserBindingVerifier(source(), 'product')(entry(), { deadlineMs: 500 })
      expect(seen).toBeInstanceOf(AbortSignal)
    })

    it('cancels the probe when the owner signal aborts and keeps the 503 class', async () => {
      const owner = new AbortController()
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) =>
              (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('x')))
            )
        )
      )
      const pending = createBrowserBindingVerifier(source(), 'product')(entry(), {
        signal: owner.signal,
      }).catch((e: unknown) => e)
      owner.abort()
      await expect(pending).resolves.toMatchObject({ status: 503 })
    })

    it('keeps the probe 429 with its retry hint', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '9' } }))
      )
      await expect(
        createBrowserBindingVerifier(source(), 'product')(entry(), { deadlineMs: 2000 })
      ).rejects.toMatchObject({
        status: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: 9,
      })
    })
  })

  it('uses a stable session cookie with separate secure host audiences', () => {
    expect(browserAnchorCookie('product').options).not.toHaveProperty('maxAge')
    expect(browserAnchorCookie('staff')).toMatchObject({
      name: '__Host-amcore_staff_context',
      options: { secure: true, httpOnly: true, sameSite: 'strict', path: '/' },
    })
    expect(browserAnchorCookie('console').name).toBe('__Host-amcore_console_context')
    expect(
      browserSessionHeaders(source(), 'product', entry())[BROWSER_AUTH_HEADERS.generation]
    ).toBe('3')
  })
})
