import { type JwtPayload, type SystemRole as Role, SystemRole } from '@amcore/shared'

import {
  acceptedMfaMethod,
  type FamilyAuthority,
  liveFamily,
  type MfaEvidence,
} from './mfa-policy.js'

export interface AccountAuthority {
  userId: string
  systemRole: Role
  securityVersion: number
  required: boolean
  setupComplete: boolean
  emergencyRequired: boolean
  factorVersion: number | null
}

export interface SessionFamilyAuthority extends FamilyAuthority, MfaEvidence {
  id: string
  primaryMethod: string
  browserContextId: string | null
  publicationGeneration: number | null
}

export interface BrowserPublicationAuthority {
  id: string
  generation: number
  currentFamilyId: string | null
  state: string
  expiresAt: Date
}

export type SessionAdmission =
  | { kind: 'admitted'; operator: boolean }
  | {
      kind: 'denied'
      reason:
        | 'account_missing'
        | 'session_changed'
        | 'browser_context_changed'
        | 'setup_required'
        | 'mfa_required'
        | 'enforcement_unavailable'
    }

function currentBrowser(
  family: SessionFamilyAuthority | null,
  context: BrowserPublicationAuthority | null,
  now: Date
): boolean {
  return (
    family !== null &&
    context !== null &&
    family.browserContextId === context.id &&
    family.publicationGeneration === context.generation &&
    context.currentFamilyId === family.id &&
    context.state === 'published' &&
    context.expiresAt > now
  )
}

function completedProofs(
  family: SessionFamilyAuthority,
  factorVersion: number | null,
  now: Date
): boolean {
  return (
    factorVersion !== null &&
    family.primaryMethod === 'password' &&
    family.primaryAt !== null &&
    family.primaryAt <= now &&
    family.mfaAt !== null &&
    family.mfaAt <= now &&
    acceptedMfaMethod(family.mfaMethod) &&
    family.factorVersion === factorVersion
  )
}

function currentFamily(
  claims: JwtPayload,
  account: AccountAuthority,
  family: SessionFamilyAuthority | null,
  now: Date
): family is SessionFamilyAuthority {
  return (
    family !== null &&
    typeof claims.fid === 'string' &&
    claims.fid.length > 0 &&
    family.id === claims.fid &&
    typeof claims.securityVersion === 'number' &&
    Number.isSafeInteger(claims.securityVersion) &&
    claims.securityVersion >= 0 &&
    claims.securityVersion === account.securityVersion &&
    liveFamily(family, claims.sub, account.securityVersion, now)
  )
}

/** Regular admission does not renew or impose the sensitive-action freshness window. */
export function admitSessionAuthority(
  claims: JwtPayload,
  account: AccountAuthority | null,
  family: SessionFamilyAuthority | null,
  context: BrowserPublicationAuthority | null,
  now: Date
): SessionAdmission {
  if (!account || account.userId !== claims.sub)
    return { kind: 'denied', reason: 'account_missing' }
  if (claims.browserBound !== undefined && claims.browserBound !== true)
    return { kind: 'denied', reason: 'browser_context_changed' }
  if (claims.browserBound && !currentBrowser(family, context, now))
    return { kind: 'denied', reason: 'browser_context_changed' }
  if (!claims.browserBound && family?.browserContextId)
    return { kind: 'denied', reason: 'browser_context_changed' }
  const protectedAccount =
    account.required ||
    account.systemRole === SystemRole.SuperAdmin ||
    claims.systemRole === SystemRole.SuperAdmin
  // Preserve residual access JWTs only for never-protected independent ordinary clients.
  if (!protectedAccount && !claims.browserBound) return { kind: 'admitted', operator: false }
  if (
    protectedAccount &&
    (!account.setupComplete || account.emergencyRequired || account.factorVersion === null)
  )
    return { kind: 'denied', reason: 'setup_required' }
  if (!currentFamily(claims, account, family, now))
    return { kind: 'denied', reason: 'session_changed' }
  if (!protectedAccount) return { kind: 'admitted', operator: false }
  if (!completedProofs(family, account.factorVersion, now))
    return { kind: 'denied', reason: 'mfa_required' }
  return {
    kind: 'admitted',
    operator:
      claims.systemRole === SystemRole.SuperAdmin && account.systemRole === SystemRole.SuperAdmin,
  }
}
