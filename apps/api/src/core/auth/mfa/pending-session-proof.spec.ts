import { JwtService } from '@nestjs/jwt'

import { SystemRole } from '@amcore/shared'

import { PendingSessionProof } from './pending-session-proof.js'

const jwt = new JwtService({ secret: '<fake-pending-publication-signing-key-at-least-32-chars>' })
const claims = {
  sub: 'account',
  sid: 'session',
  fid: 'family',
  securityVersion: 1,
  systemRole: SystemRole.User,
  browserBound: true,
}
const sign = (data: object = claims) => jwt.sign(data, { expiresIn: 60 })

describe('Purpose-limited pending JWT identity', () => {
  it('validates a signed pending identity without creating an ordinary actor', () => {
    const proof = PendingSessionProof.verify(sign(), jwt, 'invitation_publication')
    expect(proof.claims.sub).toBe('account')
    expect(proof).not.toHaveProperty('type')
    expect(proof).not.toHaveProperty('principal')
    expect(Object.isFrozen(proof.claims)).toBe(true)
  })

  it.each([
    { sid: undefined },
    { fid: undefined },
    { securityVersion: undefined },
    { securityVersion: -1 },
    { browserBound: undefined },
  ])('refuses incomplete browser claims %j', (change) => {
    expect(() =>
      PendingSessionProof.verify(sign({ ...claims, ...change }), jwt, 'browser_publication')
    ).toThrow('Invalid publication proof')
  })

  it('rejects expiry, signature tampering and algorithms outside the declared signer', () => {
    for (const token of [
      jwt.sign(claims, { expiresIn: -1 }),
      sign() + 'tampered',
      jwt.sign(claims, { expiresIn: 60, algorithm: 'HS384' }),
    ]) {
      expect(() => PendingSessionProof.verify(token, jwt, 'browser_publication')).toThrow(
        'Invalid publication proof'
      )
    }
  })

  it('separates independent protected receipts from all browser publication purposes', () => {
    const direct = sign({ ...claims, browserBound: undefined })
    expect(PendingSessionProof.verify(direct, jwt, 'direct_mfa_receipt').purpose).toBe(
      'direct_mfa_receipt'
    )
    expect(() => PendingSessionProof.verify(sign(), jwt, 'direct_mfa_receipt')).toThrow()
    expect(() => PendingSessionProof.verify(direct, jwt, 'invitation_publication')).toThrow()
  })
})
