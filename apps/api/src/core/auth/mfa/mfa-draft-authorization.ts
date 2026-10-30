import type { Prisma } from '../../../generated/prisma/client.js'

import { accountRequiresMfa } from './mfa-account-policy.js'
import type { LockedMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import { assertFlowDeadline, readFlowProofs } from './mfa-flow-state.js'
import { type MfaEvidence, requiredMfaProofs } from './mfa-policy.js'
import { validRecoverySetup } from './mfa-recovery-ticket.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type RequiredProof = 'password' | 'second_factor'
type DraftAuthority =
  | {
      outcome: 'authorized'
      email: string
      evidence: MfaEvidence
      factorVersion: number
      now: Date
    }
  | { outcome: 'proof_required'; requiredProofs: RequiredProof[] }
  | { outcome: 'restart_required' | 'already_bound' | 'unavailable' }

export class DraftFreshnessChanged extends Error {
  constructor(readonly requiredProofs: RequiredProof[]) {
    super('Draft proof changed')
  }
}

export function draftRequiredProofs(
  evidence: MfaEvidence,
  purpose: string,
  factorVersion: number,
  now: Date
): RequiredProof[] {
  return requiredMfaProofs(evidence, factorVersion, now).filter(
    (proof) => purpose === 'replace_factor' || proof === 'password'
  )
}

/** Exact source authority is already locked; this adds enrollment policy and fresh proofs. */
export async function authorizeSeedDraft(
  tx: Prisma.TransactionClient,
  locked: LockedMfaFlow
): Promise<DraftAuthority> {
  const { flow } = locked
  if (flow.purpose !== 'initial_setup' && flow.purpose !== 'replace_factor')
    return { outcome: 'restart_required' }
  const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
  if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
  const user = await tx.user.findUniqueOrThrow({
    where: { id: flow.userId },
    select: { email: true, systemRole: true },
  })
  const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: flow.userId } })
  const factor = await tx.mfaFactor.findUnique({ where: { userId: flow.userId } })
  if (
    !accountRequiresMfa({
      systemRole: user.systemRole,
      required: account.required,
      emergencyRequired: account.emergencyRequired,
      factorVersion: factor?.version ?? null,
    }) ||
    (account.emergencyRequired && !(await validRecoverySetup(tx, flow, await mfaDatabaseClock(tx))))
  )
    return { outcome: 'restart_required' }
  if (flow.purpose === 'initial_setup' && factor) return { outcome: 'already_bound' }
  if (flow.purpose === 'replace_factor' && (!locked.source || !factor || !account.setupComplete))
    return { outcome: 'restart_required' }
  const now = await mfaDatabaseClock(tx)
  assertFlowDeadline(locked, now)
  const evidence = resolveFlowProofs(readFlowProofs(flow.data), {
    flowId: flow.id,
    sourceFamilyId: flow.sourceFamilyId,
    source: locked.source,
    codeGeneration: account.codeGeneration,
  })
  const required = draftRequiredProofs(evidence, flow.purpose, factor?.version ?? 0, now)
  return required.length
    ? { outcome: 'proof_required', requiredProofs: required }
    : {
        outcome: 'authorized',
        email: user.email,
        evidence,
        factorVersion: factor?.version ?? 0,
        now,
      }
}
