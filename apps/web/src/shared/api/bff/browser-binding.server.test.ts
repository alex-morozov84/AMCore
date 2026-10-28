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
