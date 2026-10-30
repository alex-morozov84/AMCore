import { SystemRole } from '@amcore/shared'

import type {
  AuthSessionFamily,
  BrowserAuthContext,
  InvitationAuthHandoff,
  MfaFlow,
  Prisma,
  Session,
} from '../../../generated/prisma/client.js'
import {
  equalHandoffKey,
  type InvitationHandoffProof,
} from '../../invitations/invitation-auth-handoff.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import { continuationHash } from './mfa-flow-lock.js'
import { lockPublicationRows } from './mfa-publication-locks.js'
import {
  committedPublicationSource,
  type PublicationRecord,
  publicationRecordSchema,
  publicationSecretHash,
} from './mfa-publication-record.js'
import { hasCompletedMfaProofs } from './mfa-session-authority.js'
import { PendingSessionProof } from './pending-session-proof.js'

export interface PublicationCommand {
  proof: PendingSessionProof
  continuation: string
  operationId: string
  audience: string
  bindingHash: string
  browser: BrowserRequestBinding | null
  vaultBinding: string | null
  receipt: string | null
  handoff: InvitationHandoffProof | null
}
export interface LockedPublication {
  flow: MfaFlow
  record: PublicationRecord
  family: AuthSessionFamily
  session: Session
  context: BrowserAuthContext | null
  handoff: InvitationAuthHandoff | null
  alreadyPublished: boolean
  now: Date
}
export type PublicationAdmission =
  { kind: 'current'; value: LockedPublication } | { kind: 'changed' } | { kind: 'unavailable' }
const changed = { kind: 'changed' } as const

function contextMatches(
  context: BrowserAuthContext | null,
  command: PublicationCommand,
  record: PublicationRecord
): boolean {
  if (!record.browser)
    return context === null && command.browser === null && command.vaultBinding === null
  const incoming = command.browser
  return (
    !!context &&
    !!incoming &&
    context.id === record.browser.contextId &&
    incoming.contextId === context.id &&
    incoming.generation === context.generation &&
    record.browser.generation === context.generation &&
    incoming.audience === context.audience &&
    record.browser.audience === context.audience &&
    incoming.bindingHash === context.bindingHash &&
    publicationSecretHash('vault', command.vaultBinding) === record.browser.stagedBindingHash &&
    context.stagedBindingHash === record.browser.stagedBindingHash
  )
}

/** Takes attempt → context → account → user → flow/handoff → family/Session locks. */
export async function lockPublication(
  tx: Prisma.TransactionClient,
  command: PublicationCommand
): Promise<PublicationAdmission> {
  if (!(command.proof instanceof PendingSessionProof)) return changed
  const hash = continuationHash(command.continuation)
  if (!hash) return changed
  const flow = await tx.mfaFlow.findUnique({ where: { credentialHash: hash } })
  const operation = await tx.mfaOperation.findUnique({ where: { id: command.operationId } })
  const parsed = publicationRecordSchema.safeParse(operation?.result)
  if (
    !flow ||
    !parsed.success ||
    operation?.flowId !== flow.id ||
    operation.kind !== 'issue_family'
  )
    return changed
  const record = parsed.data
  const claims = command.proof.claims
  if (
    flow.userId !== claims.sub ||
    record.familyId !== claims.fid ||
    record.sessionId !== claims.sid ||
    flow.securityVersion !== claims.securityVersion ||
    record.securityVersion !== claims.securityVersion ||
    flow.audience !== command.audience ||
    flow.bindingHash !== command.bindingHash ||
    !committedPublicationSource(flow, record)
  )
    return changed
  const browser = record.browser !== null
  if (
    browser !== (claims.browserBound === true) ||
    flow.browserContextId !== (record.browser?.contextId ?? null) ||
    flow.publicationGeneration !== (record.browser?.generation ?? null)
  )
    return changed
  if (record.invitation && command.proof.purpose === 'browser_publication') return changed
  if (!record.invitation && command.proof.purpose === 'invitation_publication') return changed
  if (!!record.invitation !== !!command.handoff) return changed
  const rows = await lockPublicationRows(tx, flow, record, command)
  if (!rows) return changed
  const { flow: currentFlow, family, session, account, factor, context, handoff, user, now } = rows
  if (
    !family ||
    !session ||
    family.userId !== claims.sub ||
    session.userId !== claims.sub ||
    session.familyId !== family.id ||
    family.securityVersion !== claims.securityVersion ||
    (account?.securityVersion ?? 0) !== claims.securityVersion ||
    family.revokedAt ||
    family.expiresAt <= now ||
    session.revokedAt ||
    session.expiresAt <= now ||
    family.browserContextId !== (record.browser?.contextId ?? null) ||
    family.publicationGeneration !== (record.browser?.generation ?? null) ||
    !contextMatches(context, command, record) ||
    (context && context.expiresAt <= now)
  )
    return changed
  if (context && (flow.bindingHash !== context.bindingHash || flow.audience !== context.audience))
    return changed
  if (!!record.invitation !== !!handoff) return changed
  if (
    record.invitation &&
    (!handoff ||
      handoff.attemptId !== record.invitation.attemptId ||
      handoff.actorId !== claims.sub ||
      handoff.sessionId !== session.id ||
      !command.handoff ||
      !equalHandoffKey(handoff.cleanupKeyHash, command.handoff.cleanupKeyHash))
  )
    return changed
  const protectedSession =
    family.receiptHash !== null ||
    claims.systemRole === SystemRole.SuperAdmin ||
    accountRequiresMfa({
      systemRole: user.systemRole,
      required: account?.required ?? false,
      emergencyRequired: account?.emergencyRequired ?? false,
      factorVersion: factor?.version ?? null,
    })
  if (protectedSession) {
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { kind: 'unavailable' }
    if (
      !account?.setupComplete ||
      account.emergencyRequired ||
      !family.receiptHash ||
      family.receiptHash !== publicationSecretHash('receipt', command.receipt) ||
      !hasCompletedMfaProofs(family, factor?.version ?? null, now)
    )
      return changed
  } else if (command.receipt !== null || !browser) return changed
  const alreadyPublished =
    family.publicationState === 'published' &&
    (!context || (context.state === 'published' && context.currentFamilyId === family.id)) &&
    (!handoff || handoff.status === 'confirmed')
  if (
    !alreadyPublished &&
    (family.publicationState !== 'pending' ||
      !family.publicationDeadline ||
      family.publicationDeadline <= now ||
      (context &&
        (context.state !== 'reserved' ||
          context.currentFamilyId !== null ||
          context.reservedFlowId !== flow.id)) ||
      (handoff && (handoff.status !== 'pending' || handoff.deadline <= now)))
  )
    return changed
  return {
    kind: 'current',
    value: { flow: currentFlow, record, family, session, context, handoff, alreadyPublished, now },
  }
}
