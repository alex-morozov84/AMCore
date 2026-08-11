// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isTrustedOrigin } from './origin-guard'

// See ensure-fresh-session.basic.test.ts for why `server-only` needs mocking.
vi.mock('server-only', () => ({}))

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://next.internal/api/auth/login', { headers })
}

describe('isTrustedOrigin', () => {
  it('allows a request with no Origin or Referer header', () => {
    expect(isTrustedOrigin(requestWith({}))).toBe(true)
  })

  it('allows an exact match against WEB_TRUSTED_ORIGINS (Origin header)', () => {
    expect(isTrustedOrigin(requestWith({ origin: 'http://localhost:3002' }))).toBe(true)
  })

  it('falls back to an origin-reduced Referer when Origin is absent', () => {
    expect(
      isTrustedOrigin(requestWith({ referer: 'http://localhost:3002/login?next=/dashboard' }))
    ).toBe(true)
  })

  it('rejects a mismatched Origin', () => {
    expect(isTrustedOrigin(requestWith({ origin: 'https://evil.example' }))).toBe(false)
  })

  it('rejects a malformed Origin header rather than treating it as absent', () => {
    expect(isTrustedOrigin(requestWith({ origin: 'not a url' }))).toBe(false)
  })

  it('prefers Origin over Referer when both are present', () => {
    expect(
      isTrustedOrigin(
        requestWith({ origin: 'https://evil.example', referer: 'http://localhost:3002/login' })
      )
    ).toBe(false)
  })
})
