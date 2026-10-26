import { admitsContinuation, type ContinuationAuthority } from './mfa-continuation.js'

const now = new Date('2026-10-25T12:00:00Z')
const request = { purpose: 'rotate_codes' as const, audience: 'site', bindingHash: 'bound' }
const flow: ContinuationAuthority = {
  userId: 'account',
  purpose: 'rotate_codes',
  authorityKind: 'session',
  audience: 'site',
  bindingHash: 'bound',
  state: 'open',
  securityVersion: 4,
  sourceFamilyId: 'source-F',
  sourceSecurityVersion: 4,
  expiresAt: new Date(now.getTime() + 1000),
  attempts: 0,
}
const family = {
  id: 'source-F',
  userId: 'account',
  securityVersion: 4,
  expiresAt: flow.expiresAt,
  revokedAt: null,
  publicationState: 'published',
}

describe('Continuation authority cannot migrate between sessions or purposes', () => {
  it('allows the live exact original session without substituting another family', () => {
    expect(admitsContinuation(flow, request, 4, family, now)).toBe(true)
    expect(admitsContinuation(flow, request, 4, { ...family, id: 'target-G' }, now)).toBe(false)
    expect(admitsContinuation(flow, request, 4, null, now)).toBe(false)
    expect(admitsContinuation(flow, request, 4, { ...family, revokedAt: now }, now)).toBe(false)
  })

  it.each([
    { state: 'completed' },
    { expiresAt: now },
    { attempts: 5 },
    { securityVersion: 3 },
    { audience: 'console' },
    { bindingHash: 'other-browser' },
    { purpose: 'replace_factor' },
    { authorityKind: 'unknown' },
    { sourceSecurityVersion: 3 },
    { sourceFamilyId: null },
  ])('refuses altered or stale authority %j', (change) => {
    expect(admitsContinuation({ ...flow, ...change }, request, 4, family, now)).toBe(false)
  })

  it('cannot reinterpret a session-derived flow as a new login', () => {
    expect(
      admitsContinuation(
        { ...flow, purpose: 'login' },
        { ...request, purpose: 'login' },
        4,
        family,
        now
      )
    ).toBe(false)
    expect(
      admitsContinuation({ ...flow, authorityKind: 'identity' }, request, 4, family, now)
    ).toBe(false)
  })

  it('limits identity continuations to login/setup with no inherited family', () => {
    const identity = {
      ...flow,
      purpose: 'login',
      authorityKind: 'identity',
      sourceFamilyId: null,
      sourceSecurityVersion: null,
    }
    expect(admitsContinuation(identity, { ...request, purpose: 'login' }, 4, null, now)).toBe(true)
    expect(
      admitsContinuation(
        { ...identity, sourceFamilyId: 'source-F' },
        { ...request, purpose: 'login' },
        4,
        family,
        now
      )
    ).toBe(false)
  })
})
