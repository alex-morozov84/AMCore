import { afterEach, describe, expect, it, vi } from 'vitest'

import { invitationRequestAuthority } from './invitation-request-authority'

vi.mock('server-only', () => ({}))
afterEach(() => vi.unstubAllEnvs())
const origin = 'https://app.example.test'
function request(headers: Record<string, string> = {}) {
  vi.stubEnv('WEB_TRUSTED_ORIGINS', `${origin},https://other.example.test`)
  return new Request(`${origin}/api/invitation-flows/example/context`, { headers })
}

describe('invitation request authority', () => {
  it('requires exact Origin for writes, with no Referer or headerless fallback', () => {
    const invalid: Record<string, string>[] = [{}, { referer: `${origin}/en/invite/flow/example` },
      { origin: 'null' }, { origin: `${origin}/` }, { origin: 'https://other.example.test' }]
    for (const headers of invalid) {
      expect(() => invitationRequestAuthority(request(headers), true)).toThrow()
    }
    expect(invitationRequestAuthority(request({ origin }), true).policy.origin).toBe(origin)
    expect(invitationRequestAuthority(request(), false).ownerHash).toBeNull()
  })

  it('does not derive origin authority from forwarded host/protocol headers', () => {
    const incoming = request({ origin, 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'http' })
    expect(invitationRequestAuthority(incoming, true).policy.origin).toBe(origin)
    expect(() => invitationRequestAuthority(new Request('https://evil.example.test/api/invitation-flows/x'), false)).toThrow()
  })

  it('requires an unambiguous configured cookie and returns only its hash', () => {
    const proof = 'a'.repeat(43)
    const cookie = `__Host-amcore_invite_browser=${proof}`
    expect(invitationRequestAuthority(request({ cookie }), false).ownerHash).toMatch(/^[a-f0-9]{64}$/)
    expect(() => invitationRequestAuthority(request({ cookie: `${cookie}; ${cookie}` }), false)).toThrow()
    expect(invitationRequestAuthority(request({ cookie: `amcore_invite_browser_local=${proof}` }), false).ownerHash).toBeNull()
  })
  it('uses configured public Host behind a standalone internal request URL', () => {
    vi.stubEnv('WEB_TRUSTED_ORIGINS', origin)
    const internal = new Request('http://0.0.0.0:3000/api/invitation-flows/x/context', {
      headers: { host: 'app.example.test', origin, 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'http' },
    })
    expect(invitationRequestAuthority(internal, true).policy.origin).toBe(origin)
    expect(() => invitationRequestAuthority(new Request(internal.url, { headers: { host: 'evil.example.test' } }), false)).toThrow()
    vi.stubEnv('WEB_TRUSTED_ORIGINS', `${origin},http://app.example.test`)
    expect(() => invitationRequestAuthority(internal, false)).toThrow()
  })

})
