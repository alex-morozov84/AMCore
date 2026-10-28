import type {
  AuthSessionFamily,
  BrowserAuthContext,
  InvitationAuthHandoff,
  MfaAccount,
  MfaFactor,
  MfaFlow,
  Prisma,
  Session,
} from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/index.js'
import {
  type InvitationUser,
  lockInvitation,
  lockInvitationOrg,
  lockInvitationUser,
} from '../../invitations/invitation-locks.js'
import { currentInvitationIntent } from '../../invitations/invitation-role-intent.js'
import { managedInvitationOwner } from '../../invitations/managed-invitation.js'

import { continuationHash } from './mfa-flow-lock.js'
import type { PublicationCommand } from './mfa-publication-authority.js'
import { committedPublicationSource, type PublicationRecord } from './mfa-publication-record.js'
import { validSetupSuccessor } from './mfa-setup-transfer.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

interface PublicationRows {
  flow: MfaFlow
  family: AuthSessionFamily | null
  session: Session | null
  account: MfaAccount | null
  factor: Pick<MfaFactor, 'version'> | null
  context: BrowserAuthContext | null
  handoff: InvitationAuthHandoff | null
  user: InvitationUser
  now: Date
}

/** Ordered locks and primary snapshots; callers validate every tuple before effects. */
export async function lockPublicationRows(
  tx: Prisma.TransactionClient,
  flow: MfaFlow,
  record: PublicationRecord,
  command: PublicationCommand
): Promise<PublicationRows | null> {
  const claims = command.proof.claims
  const hash = continuationHash(command.continuation)
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  if (record.invitation) {
    if (command.handoff?.attemptId !== record.invitation.attemptId) return null
    await acquireXactLock(tx, `invitation-auth-attempt:${record.invitation.attemptId}`)
  }
  if (record.browser) {
    if (command.browser?.contextId !== record.browser.contextId) return null
    await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${record.browser.contextId} FOR UPDATE`
  }
  await lockMfaAccounts(tx, [flow.userId])
  const user = await lockInvitationUser(tx, flow.userId)
  if (!user) return null
  if (record.invitation) {
    const previousFamily = await tx.authSessionFamily.findUnique({ where: { id: record.familyId } })
    const previousHandoff = await tx.invitationAuthHandoff.findUnique({
      where: { attemptId: record.invitation.attemptId },
    })
    const alreadyConfirmed =
      previousFamily?.publicationState === 'published' && previousHandoff?.status === 'confirmed'
    if (!alreadyConfirmed) {
      const intent = record.invitation
      await lockInvitationOrg(tx, intent.organizationId, true)
      await managedInvitationOwner(tx, intent.organizationId, intent.inviteId)
      await currentInvitationIntent(tx, intent.inviteId, intent.organizationId, true)
      const invite = await lockInvitation(tx, intent.inviteId, intent.organizationId)
      const now = await mfaDatabaseClock(tx)
      if (
        !invite ||
        invite.generation !== intent.generation ||
        invite.emailCanonical !== intent.recipient ||
        user.emailCanonical !== intent.recipient ||
        invite.intentInvalid ||
        invite.acceptedAt ||
        invite.revokedAt ||
        invite.expiresAt <= now
      )
        return null
    }
  }
  await tx.$queryRaw`SELECT id FROM core.mfa_flows WHERE id = ${flow.id} FOR UPDATE`
  const currentFlow = await tx.mfaFlow.findUnique({ where: { id: flow.id } })
  if (
    !currentFlow ||
    !committedPublicationSource(currentFlow, record) ||
    currentFlow.securityVersion !== claims.securityVersion ||
    currentFlow.userId !== flow.userId ||
    currentFlow.credentialHash !== hash ||
    currentFlow.browserContextId !== flow.browserContextId ||
    currentFlow.publicationGeneration !== flow.publicationGeneration ||
    currentFlow.audience !== command.audience ||
    currentFlow.bindingHash !== command.bindingHash
  )
    return null
  if (record.invitation) {
    await tx.$queryRaw`SELECT "attemptId" FROM core.invitation_auth_handoffs WHERE "attemptId" = ${record.invitation.attemptId} FOR UPDATE`
  }
  await tx.$queryRaw`SELECT id FROM core.auth_session_families WHERE id = ${record.familyId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM core.sessions WHERE id = ${record.sessionId} FOR UPDATE`
  const family = await tx.authSessionFamily.findUnique({ where: { id: record.familyId } })
  const session = await tx.session.findUnique({ where: { id: record.sessionId } })
  const account = await tx.mfaAccount.findUnique({ where: { userId: flow.userId } })
  const factor = await tx.mfaFactor.findUnique({
    where: { userId: flow.userId },
    select: { version: true },
  })
  const context = record.browser
    ? await tx.browserAuthContext.findUnique({ where: { id: record.browser.contextId } })
    : null
  const handoff = await tx.invitationAuthHandoff.findUnique({
    where: { sessionId: record.sessionId },
  })
  const now = await mfaDatabaseClock(tx)
  if (
    currentFlow.authorityKind === 'setup_successor' &&
    !(await validSetupSuccessor(tx, currentFlow, context, now, 'publication'))
  )
    return null
  return { flow: currentFlow, family, session, account, factor, context, handoff, user, now }
}
