import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  invitationCookiePolicy,
  invitationLocalOrigin,
  invitationOwnerMaxAge,
  readInvitationOwner,
} from './invitation-cookie'

describe('invitation owner cookie', () => {
  const local = {
    WEB_INVITATION_LOCAL_HTTP_ORIGIN: 'http://127.0.0.1:3411',
    WEB_TRUSTED_ORIGINS: 'http://127.0.0.1:3411',
  }

  it('always uses the Secure Host-prefixed proof on HTTPS', () => {
    expect(invitationCookiePolicy('https://app.example.test/en/invite', local)).toEqual({
      origin: 'https://app.example.test',
      name: '__Host-amcore_invite_browser',
      options: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    })
  })

  it('allows only the configured exact local HTTP origin with a distinct cookie', () => {
    expect(invitationCookiePolicy('http://127.0.0.1:3411/en/invite', local)).toMatchObject({
      name: 'amcore_invite_browser_local',
      options: { secure: false, httpOnly: true },
    })
    expect(() => invitationCookiePolicy('http://127.0.0.1:3412/en/invite', local)).toThrow()
    expect(() => invitationCookiePolicy('http://localhost:3002/en/invite', {})).toThrow()
  })

  it.each(['localhost', '127.0.0.1', '[::1]', 'product.localhost'])(
    'admits the explicitly trusted loopback host %s',
    (hostname) => {
      const origin = `http://${hostname}:3411`
      expect(
        invitationLocalOrigin({
          WEB_INVITATION_LOCAL_HTTP_ORIGIN: origin,
          WEB_TRUSTED_ORIGINS: origin,
        })
      ).toBe(origin)
    }
  )

  it.each([
    'http://localhost:3411/',
    'http://localhost:3411?x=1',
    'http://person@localhost:3411',
    'https://localhost:3411',
    'http://localhost.example.test:3411',
    'http://bad_local.localhost:3411',
    'http://example.test:3411',
  ])('rejects unsafe or noncanonical local origin %s', (origin) => {
    expect(() =>
      invitationLocalOrigin({
        WEB_INVITATION_LOCAL_HTTP_ORIGIN: origin,
        WEB_TRUSTED_ORIGINS: origin,
      })
    ).toThrow()
  })

  it('rejects a local origin outside the trusted deployment origins', () => {
    expect(() =>
      invitationLocalOrigin({ ...local, WEB_TRUSTED_ORIGINS: 'https://app.example.test' })
    ).toThrow()
  })

  it('rejects duplicate proof cookies even when their values match', () => {
    const value = 'a'.repeat(43)
    const cookie = `__Host-amcore_invite_browser=${value}`
    expect(readInvitationOwner(cookie, '__Host-amcore_invite_browser')).toBe(value)
    expect(() =>
      readInvitationOwner(`${cookie}; ${cookie}`, '__Host-amcore_invite_browser')
    ).toThrow()
    expect(
      readInvitationOwner(`amcore_invite_browser_local=${value}`, '__Host-amcore_invite_browser')
    ).toBeNull()
  })

  it('keeps the absolute owner lifetime instead of sliding on every admission', () => {
    expect(invitationOwnerMaxAge(86400000, 3600000)).toBe(82800)
    expect(invitationOwnerMaxAge(1000, 2000)).toBe(0)
  })
})
