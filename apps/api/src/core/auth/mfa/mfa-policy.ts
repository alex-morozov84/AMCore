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
function fresh(at: Date | null, now: Date): boolean {
  if (!at) return false
  const age = now.getTime() - at.getTime()
  return age >= 0 && age <= 600_000
}

export function requiredMfaProofs(
  evidence: MfaEvidence,
  factorVersion: number,
  now: Date
): Array<'password' | 'second_factor'> {
  const required: Array<'password' | 'second_factor'> = []
  if (!evidence.primaryProofId || !fresh(evidence.primaryAt, now)) required.push('password')
  if (
    !evidence.mfaProofId ||
    !acceptedMfaMethod(evidence.mfaMethod) ||
    evidence.factorVersion !== factorVersion ||
    !fresh(evidence.mfaAt, now)
  )
    required.push('second_factor')
  return required
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
