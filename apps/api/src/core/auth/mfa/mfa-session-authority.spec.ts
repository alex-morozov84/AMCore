import { type JwtPayload, SystemRole } from '@amcore/shared'

import {
  type AccountAuthority,
  admitSessionAuthority,
  type BrowserPublicationAuthority,
  type SessionFamilyAuthority,
} from './mfa-session-authority.js'

const now = new Date('2026-10-26T12:00:00Z')
const claims: JwtPayload = {
  sub: 'account',
  email: 'operator@example.test',
  systemRole: SystemRole.SuperAdmin,
  fid: 'family-A',
  securityVersion: 3,
  browserBound: true,
}
const account: AccountAuthority = {
  userId: claims.sub,
  systemRole: SystemRole.SuperAdmin,
  securityVersion: 3,
  required: true,
  setupComplete: true,
  emergencyRequired: false,
  factorVersion: 2,
}
const family: SessionFamilyAuthority = {
  id: 'family-A',
  userId: claims.sub,
  securityVersion: 3,
  expiresAt: new Date(now.getTime() + 60_000),
  revokedAt: null,
  publicationState: 'published',
  primaryMethod: 'password',
  primaryAt: new Date(now.getTime() - 3_600_000),
  primaryProofId: 'password-event',
  mfaMethod: 'recovery_code',
  mfaAt: new Date(now.getTime() - 3_600_000),
  mfaProofId: 'second-factor-event',
  factorVersion: 2,
  browserContextId: 'browser',
  publicationGeneration: 4,
}
const context: BrowserPublicationAuthority = {
  bindingHash: 'binding-hash',
  audience: 'product',
  id: 'browser',
  generation: 4,
  currentFamilyId: 'family-A',
  state: 'published',
  expiresAt: family.expiresAt,
}

const binding = {
  contextId: context.id,
  generation: 4,
  audience: 'product' as const,
  bindingHash: context.bindingHash,
}

describe('Current family and browser authority before normal admission', () => {
  it.each(['totp', 'recovery_code'])('admits established %s proof beyond step-up age', (method) => {
    expect(
      admitSessionAuthority(
        claims,
        account,
        { ...family, mfaMethod: method },
        context,
        now,
        binding
      )
    ).toEqual({ kind: 'admitted', operator: true })
  })

  it('refuses a late A cookie after B became the current browser generation', () => {
    const next = { ...context, generation: 5, currentFamilyId: 'family-B' }
    expect(admitSessionAuthority(claims, account, family, next, now, binding)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
    expect(admitSessionAuthority(claims, account, family, null, now, binding).kind).toBe('denied')
  })

  it.each([
    { revokedAt: now },
    { expiresAt: now },
    { publicationState: 'pending' },
    { userId: 'other-account' },
    { securityVersion: 2 },
    { id: 'family-B' },
  ])('refuses revoked, stale or substituted family authority %j', (change) => {
    expect(
      admitSessionAuthority(claims, account, { ...family, ...change }, context, now, binding).kind
    ).toBe('denied')
  })

  it.each([
    { primaryMethod: 'oauth' },
    { primaryAt: null },
    { primaryProofId: null },
    { mfaMethod: null },
    { mfaMethod: 'unknown' },
    { mfaAt: null },
    { mfaProofId: null },
    { mfaAt: new Date(now.getTime() + 1) },
    { factorVersion: 1 },
  ])('does not turn identity or incomplete proof into MFA %j', (change) => {
    expect(
      admitSessionAuthority(claims, account, { ...family, ...change }, context, now, binding)
    ).toEqual({
      kind: 'denied',
      reason: 'mfa_required',
    })
  })

  it('requires setup acknowledgement and rejects emergency-reset authority', () => {
    for (const change of [
      { setupComplete: false },
      { emergencyRequired: true },
      { factorVersion: null },
    ])
      expect(
        admitSessionAuthority(claims, { ...account, ...change }, family, context, now, binding)
      ).toEqual({
        kind: 'denied',
        reason: 'setup_required',
      })
  })

  it('keeps demoted accounts protected without granting the old operator claim', () => {
    const demoted = { ...account, systemRole: SystemRole.User }
    expect(admitSessionAuthority(claims, demoted, family, context, now, binding)).toEqual({
      kind: 'admitted',
      operator: false,
    })
    expect(
      admitSessionAuthority(claims, demoted, { ...family, mfaAt: null }, context, now, binding).kind
    ).toBe('denied')
  })

  it('does not promote a signed ordinary claim from the current DB role', () => {
    expect(
      admitSessionAuthority(
        { ...claims, systemRole: SystemRole.User },
        account,
        family,
        context,
        now,
        binding
      )
    ).toEqual({ kind: 'admitted', operator: false })
  })

  it('denies browser reset/revocation while preserving independent ordinary access JWT lifetime', () => {
    const ordinary = {
      ...account,
      systemRole: SystemRole.User,
      required: false,
      factorVersion: null,
      securityVersion: 4,
    }
    const browser = { ...claims, systemRole: SystemRole.User }
    expect(admitSessionAuthority(browser, ordinary, family, context, now, binding).kind).toBe(
      'denied'
    )
    const direct = { sub: claims.sub, email: claims.email, systemRole: SystemRole.User }
    expect(admitSessionAuthority(direct, ordinary, null, null, now)).toEqual({
      kind: 'admitted',
      operator: false,
    })
    expect(admitSessionAuthority(direct, ordinary, null, null, now, binding)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
    expect(
      admitSessionAuthority(direct, { ...ordinary, required: true }, null, null, now).kind
    ).toBe('denied')
  })

  it('cannot strip the browser marker from a stored browser-bound family', () => {
    const { browserBound: _marker, ...unmarked } = claims
    expect(admitSessionAuthority(unmarked, account, family, context, now, binding)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
  })
})

it('requires the actual request binding and rejects scope substitutions', () => {
  for (const incoming of [
    null,
    { ...binding, bindingHash: 'other' },
    { ...binding, audience: 'console' as const },
    { ...binding, generation: 5 },
    { ...binding, contextId: 'other' },
  ]) {
    expect(admitSessionAuthority(claims, account, family, context, now, incoming)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
  }
})
