import type {
  AuthSessionFamily,
  BrowserAuthContext,
  InvitationAuthHandoff,
  MfaFlow,
  Prisma,
  Session,
} from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/index.js'

import { continuationHash, type FlowRequest } from './mfa-flow-lock.js'
import {
  committedPublicationSource,
  declaredPublicationSource,
  type PublicationRecord,
  publicationRecordSchema,
} from './mfa-publication-record.js'
import { validSetupSuccessor } from './mfa-setup-transfer.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export interface PublicationContinuation {
  flow: MfaFlow
  record: PublicationRecord
  family: AuthSessionFamily
  session: Session
  context: BrowserAuthContext | null
  handoff: InvitationAuthHandoff | null
  now: Date
}

function supportsStatus(flow: MfaFlow, record: PublicationRecord): boolean {
  return (
    committedPublicationSource(flow, record) ||
    (flow.state === 'retired' && declaredPublicationSource(flow, record))
  )
}

function browserMatches(
  request: FlowRequest,
  flow: MfaFlow,
  record: PublicationRecord,
  context: BrowserAuthContext | null,
  now: Date
): boolean {
  if (!record.browser)
    return (
      request.browser === null &&
      context === null &&
      flow.browserContextId === null &&
      flow.publicationGeneration === null
    )
  const binding = request.browser
  return (
    !!binding &&
    !!context &&
    context.expiresAt > now &&
    context.id === record.browser.contextId &&
    flow.browserContextId === context.id &&
    binding.contextId === context.id &&
    binding.bindingHash === context.bindingHash &&
    request.bindingHash === context.bindingHash &&
    flow.publicationGeneration === context.generation &&
    record.browser.generation === context.generation &&
    binding.generation === context.generation &&
    record.browser.audience === context.audience &&
    request.audience === context.audience &&
    binding.audience === context.audience &&
    (record.browser.stagedBindingHash === context.stagedBindingHash ||
      (flow.state === 'retired' &&
        context.state === 'logged_out' &&
        context.stagedBindingHash === null))
  )
}

/** Restricted parent capability for own nonsecret status/retirement; never an actor or acknowledgement proof. */
export async function lockPublicationContinuation(
  tx: Prisma.TransactionClient,
  request: FlowRequest,
  operationId: string
): Promise<PublicationContinuation | null> {
  const hash = continuationHash(request.credential)
  if (!hash) return null
  const hint = await tx.mfaFlow.findUnique({ where: { credentialHash: hash } })
  const operation = await tx.mfaOperation.findUnique({ where: { id: operationId } })
  const parsed = publicationRecordSchema.safeParse(operation?.result)
  if (
    !hint ||
    !parsed.success ||
    operation?.flowId !== hint.id ||
    operation.kind !== 'issue_family'
  )
    return null
  const record = parsed.data
  if (
    !supportsStatus(hint, record) ||
    hint.purpose !== request.purpose ||
    hint.audience !== request.audience ||
    hint.bindingHash !== request.bindingHash ||
    hint.securityVersion !== record.securityVersion
  )
    return null
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  if (record.invitation)
    await acquireXactLock(tx, `invitation-auth-attempt:${record.invitation.attemptId}`)
  if (record.browser) {
    if (request.browser?.contextId !== record.browser.contextId) return null
    await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${record.browser.contextId} FOR UPDATE`
  } else if (request.browser) return null
  await lockMfaAccounts(tx, [hint.userId])
  await tx.$queryRaw`SELECT id FROM core.mfa_flows WHERE id = ${hint.id} FOR UPDATE`
  const flow = await tx.mfaFlow.findUnique({ where: { credentialHash: hash } })
  if (
    !flow ||
    flow.id !== hint.id ||
    flow.userId !== hint.userId ||
    !supportsStatus(flow, record) ||
    flow.purpose !== request.purpose ||
    flow.audience !== request.audience ||
    flow.bindingHash !== request.bindingHash ||
    flow.securityVersion !== record.securityVersion
  )
    return null
  if (record.invitation)
    await tx.$queryRaw`SELECT "attemptId" FROM core.invitation_auth_handoffs WHERE "attemptId" = ${record.invitation.attemptId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM core.auth_session_families WHERE id = ${record.familyId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM core.sessions WHERE id = ${record.sessionId} FOR UPDATE`
  const family = await tx.authSessionFamily.findUnique({ where: { id: record.familyId } })
  const session = await tx.session.findUnique({ where: { id: record.sessionId } })
  const account = await tx.mfaAccount.findUnique({ where: { userId: flow.userId } })
  const context = record.browser
    ? await tx.browserAuthContext.findUnique({ where: { id: record.browser.contextId } })
    : null
  const handoff = await tx.invitationAuthHandoff.findUnique({
    where: { sessionId: record.sessionId },
  })
  const now = await mfaDatabaseClock(tx)
  if (
    !family ||
    !session ||
    family.userId !== flow.userId ||
    session.userId !== flow.userId ||
    session.familyId !== family.id ||
    family.securityVersion !== record.securityVersion ||
    (account?.securityVersion ?? 0) !== record.securityVersion ||
    family.browserContextId !== (record.browser?.contextId ?? null) ||
    family.publicationGeneration !== (record.browser?.generation ?? null) ||
    !browserMatches(request, flow, record, context, now) ||
    !!record.invitation !== !!handoff ||
    (handoff &&
      (handoff.attemptId !== record.invitation?.attemptId || handoff.actorId !== flow.userId))
  )
    return null
  if (
    context &&
    !(
      (context.state === 'reserved' &&
        context.currentFamilyId === null &&
        context.reservedFlowId === flow.id) ||
      (context.state === 'published' && context.currentFamilyId === family.id) ||
      (flow.state === 'retired' &&
        family.publicationState === 'retired' &&
        context.state === 'logged_out' &&
        context.currentFamilyId === null &&
        context.reservedFlowId === null)
    )
  )
    return null
  if (
    flow.authorityKind === 'setup_successor' &&
    !(await validSetupSuccessor(tx, flow, context, now, 'publication'))
  )
    return null
  return { flow, record, family, session, context, handoff, now }
}
