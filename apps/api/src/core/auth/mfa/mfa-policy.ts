import type { MfaMethod } from '@amcore/shared'

/** These are assurance methods, never role or organization grants. */
export interface MfaEvidence {
  primaryAt: Date | null
  primaryProofId: string | null
  mfaAt: Date | null
  mfaProofId: string | null
  mfaMethod: string | null
  factorVersion: number | null
}

export function acceptedMfaMethod(method: string | null): method is MfaMethod {
  return method === 'totp' || method === 'recovery_code'
}

/** Inclusive boundary, matching existing recent-auth semantics; future proof is invalid. */
function fresh(at: Date | null, now: Date, windowSec: number): boolean {
  if (!at) return false
  const age = now.getTime() - at.getTime()
  return age >= 0 && age <= Math.min(600, windowSec) * 1000
}

export function requiredMfaProofs(
  evidence: MfaEvidence,
  factorVersion: number,
  now: Date,
  windowSec = 600
): Array<'password' | 'second_factor'> {
  const required: Array<'password' | 'second_factor'> = []
  if (!evidence.primaryProofId || !fresh(evidence.primaryAt, now, windowSec))
    required.push('password')
  if (
    !evidence.mfaProofId ||
    !acceptedMfaMethod(evidence.mfaMethod) ||
    evidence.factorVersion !== factorVersion ||
    !fresh(evidence.mfaAt, now, windowSec)
  )
    required.push('second_factor')
  return required
}

/** Ordinary families retain the configurable primary-authentication window without requiring MFA. */
export function requiredPrimaryProofs(
  evidence: Pick<MfaEvidence, 'primaryAt' | 'primaryProofId'>,
  now: Date,
  windowSec: number
): Array<'password'> {
  const age = evidence.primaryAt ? now.getTime() - evidence.primaryAt.getTime() : -1
  return evidence.primaryProofId && age >= 0 && age <= windowSec * 1000 ? [] : ['password']
}

export interface FamilyAuthority {
  userId: string
  securityVersion: number
  expiresAt: Date
  revokedAt: Date | null
  publicationState: string
}

export function liveFamily(
  family: FamilyAuthority | null,
  userId: string,
  securityVersion: number,
  now: Date
): boolean {
  return (
    family !== null &&
    family.userId === userId &&
    family.securityVersion === securityVersion &&
    family.revokedAt === null &&
    family.expiresAt.getTime() > now.getTime() &&
    family.publicationState === 'published'
  )
}
