// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isFormPostProvider, relayOAuthCookies } from './oauth-cookie-relay'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

function fakeUpstream(setCookieHeaders: string[]): Response {
  return { headers: { getSetCookie: () => setCookieHeaders } } as unknown as Response
}

describe('isFormPostProvider', () => {
  it('is true only for apple', () => {
    expect(isFormPostProvider('apple')).toBe(true)
    expect(isFormPostProvider('google')).toBe(false)
    expect(isFormPostProvider('github')).toBe(false)
  })
})

describe('relayOAuthCookies', () => {
  it('relays a non-apple cookie unchanged', () => {
    const upstream = fakeUpstream(['oauth_state=nonce-1; Path=/; HttpOnly; SameSite=Lax'])
    const target = new Headers()

    relayOAuthCookies(upstream, 'google', target)

    expect(target.get('set-cookie')).toBe('oauth_state=nonce-1; Path=/; HttpOnly; SameSite=Lax')
  })

  it("rewrites the apple binding cookie's Path from the backend path to the frontend path", () => {
    const upstream = fakeUpstream([
      'oauth_state_apple=nonce-1; Path=/api/v1/auth/oauth/apple/callback; HttpOnly; SameSite=None; Secure',
    ])
    const target = new Headers()

    relayOAuthCookies(upstream, 'apple', target)

    expect(target.get('set-cookie')).toBe(
      'oauth_state_apple=nonce-1; Path=/api/auth/oauth/apple/callback; HttpOnly; SameSite=None; Secure'
    )
  })

  it('rewrites the Path on an apple cookie-clearing response too (Expires in the past, no value)', () => {
    const upstream = fakeUpstream([
      'oauth_state_apple=; Path=/api/v1/auth/oauth/apple/callback; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ])
    const target = new Headers()

    relayOAuthCookies(upstream, 'apple', target)

    expect(target.get('set-cookie')).toBe(
      'oauth_state_apple=; Path=/api/auth/oauth/apple/callback; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    )
  })

  it('relays refresh_token (path=/) unchanged even for apple, since it is not path-scoped', () => {
    const upstream = fakeUpstream(['refresh_token=rt-1; Path=/; HttpOnly; SameSite=Strict'])
    const target = new Headers()

    relayOAuthCookies(upstream, 'apple', target)

    expect(target.get('set-cookie')).toBe('refresh_token=rt-1; Path=/; HttpOnly; SameSite=Strict')
  })

  it('relays multiple Set-Cookie headers, appending rather than overwriting', () => {
    const upstream = fakeUpstream([
      'refresh_token=rt-1; Path=/',
      'oauth_state_apple=nonce-1; Path=/api/v1/auth/oauth/apple/callback',
    ])
    const target = new Headers()

    relayOAuthCookies(upstream, 'apple', target)

    const all = target.getSetCookie()
    expect(all).toHaveLength(2)
    expect(all).toContain('refresh_token=rt-1; Path=/')
    expect(all).toContain('oauth_state_apple=nonce-1; Path=/api/auth/oauth/apple/callback')
  })

  it('does nothing when there are no Set-Cookie headers', () => {
    const target = new Headers()
    relayOAuthCookies(fakeUpstream([]), 'google', target)
    expect(target.get('set-cookie')).toBeNull()
  })
})
