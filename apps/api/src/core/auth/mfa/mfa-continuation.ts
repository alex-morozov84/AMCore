import type { MfaPurpose } from '@amcore/shared'

import { type FamilyAuthority, liveFamily } from './mfa-policy.js'

export interface ContinuationAuthority {
  userId: string
  purpose: string
  authorityKind: string
  audience: string
  bindingHash: string
  state: string
  securityVersion: number
  sourceFamilyId: string | null
  sourceSecurityVersion: number | null
  expiresAt: Date
  attempts: number
}

export interface ContinuationRequest {
  purpose: MfaPurpose
  audience: string
  bindingHash: string
}

/** Authority only; freshness, budgets and proof consumption remain separate. */
export function admitsContinuation(
  flow: ContinuationAuthority,
  request: ContinuationRequest,
  securityVersion: number,
  source: (FamilyAuthority & { id: string }) | null,
  now: Date
): boolean {
  if (
    flow.state !== 'open' ||
    flow.expiresAt <= now ||
    flow.attempts >= 5 ||
    flow.securityVersion !== securityVersion ||
    flow.purpose !== request.purpose ||
    flow.audience !== request.audience ||
    flow.bindingHash !== request.bindingHash
  )
    return false
  if (flow.authorityKind === 'identity') {
    return (
      (flow.purpose === 'login' || flow.purpose === 'initial_setup') &&
      flow.sourceFamilyId === null &&
      flow.sourceSecurityVersion === null
    )
  }
  if (flow.authorityKind !== 'session' || flow.purpose === 'login') return false
  return (
    source !== null &&
    source.id === flow.sourceFamilyId &&
    flow.sourceSecurityVersion === securityVersion &&
    liveFamily(source, flow.userId, securityVersion, now)
  )
}
