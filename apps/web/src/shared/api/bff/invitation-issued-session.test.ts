import { describe, expect, it, vi } from 'vitest'

import { invitationIssuedSessionId } from './invitation-issued-session'

vi.mock('server-only', () => ({}))
function token(claims: unknown) {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`
}
describe('issued invitation session correlation', () => {
  it('reads only the actor-matching backend sid for later authoritative confirmation', () => {
    expect(invitationIssuedSessionId(token({ sub: 'example-user', sid: 'example-session' }), 'example-user')).toBe('example-session')
  })
  it('fails closed on malformed, oversized, missing or mismatched correlation without retaining the token', () => {
    for (const input of ['invalid-token', 'x'.repeat(8193), token({ sub: 'other-user', sid: 'example-session' }),
      token({ sub: 'example-user' }), token({ sub: 'example-user', sid: '../foreign-key' })]) {
      try {
        invitationIssuedSessionId(input, 'example-user')
        expect.unreachable()
      } catch (error) {
        expect(error).toMatchObject({ status: 503, knownRejection: false })
        expect(String(error)).not.toContain(input)
      }
    }
  })
})
