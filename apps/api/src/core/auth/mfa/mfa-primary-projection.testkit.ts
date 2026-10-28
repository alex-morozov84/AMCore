import type { RequestPrincipal } from '@amcore/shared'

import type { MfaPrimaryProjection } from './mfa-primary-projection.schema.js'

/** Domain-unit data only: an explicitly protected independent family, never legacy admission. */
export function protectedUnitProjection(
  principal: RequestPrincipal,
  proofAt: Date,
  now = new Date()
): MfaPrimaryProjection {
  if (!principal.fid) throw new Error('Protected unit fixture requires an explicit family claim')
  const version = principal.securityVersion ?? 0
  return {
    now,
    user: {
      id: principal.sub,
      systemRole: principal.systemRole,
      mfaAccount: {
        securityVersion: version,
        required: true,
        setupComplete: true,
        emergencyRequired: false,
      },
      mfaFactor: { version: 1 },
    },
    protocol: { state: 'active', version: 1 },
    session: null,
    family: {
      id: principal.fid,
      userId: principal.sub,
      securityVersion: version,
      expiresAt: new Date(proofAt.getTime() + 3600000),
      revokedAt: null,
      publicationState: 'published',
      primaryMethod: 'password',
      primaryAt: proofAt,
      primaryProofId: 'unit-local-password',
      mfaMethod: 'totp',
      mfaAt: proofAt,
      mfaProofId: 'unit-local-factor',
      factorVersion: 1,
      browserContextId: null,
      publicationGeneration: null,
      browserContext: null,
    },
  }
}
