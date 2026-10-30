import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { BrowserFrontendContext } from '../../frontend-context/frontend-placement.js'
import { assertTokenFrontend } from '../../frontend-context/frontend-token.js'
import type { InvitationHandoffProof } from '../../invitations/invitation-auth-handoff.js'
import {
  invitationCredentialHint,
  invitationSecretHash,
} from '../../invitations/invitation-credential.js'
import {
  invalidInvitation,
  lockInvitation,
  lockInvitationOrg,
} from '../../invitations/invitation-locks.js'
import { currentInvitationIntent } from '../../invitations/invitation-role-intent.js'
import { managedInvitationOwner } from '../../invitations/managed-invitation.js'

import { publicationRecordSchema } from './mfa-publication-record.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface InvitationLoginScope {
  credential: string
  handoff: InvitationHandoffProof
  frontend?: BrowserFrontendContext
}
export const storedInvitationIntentSchema = publicationRecordSchema.shape.invitation
  .unwrap()
  .extend({
    cleanupKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict()
export type StoredInvitationIntent = z.infer<typeof storedInvitationIntentSchema>

/** Caller holds attempt, browser, account and user locks before invitation locks. */
export async function captureInvitationLogin(
  tx: Prisma.TransactionClient,
  scope: InvitationLoginScope,
  recipient: string
): Promise<StoredInvitationIntent> {
  const hint = await invitationCredentialHint(tx, { continuation: scope.credential })
  assertTokenFrontend(hint.invite, scope.frontend)
  const intent: StoredInvitationIntent = {
    attemptId: scope.handoff.attemptId,
    cleanupKeyHash: scope.handoff.cleanupKeyHash,
    credentialHash: invitationSecretHash(scope.credential),
    inviteId: hint.invite.id,
    organizationId: hint.invite.organizationId,
    generation: hint.generation,
    recipient,
    expiresAt: new Date(
      Math.min(hint.expiresAt.getTime(), hint.invite.expiresAt.getTime())
    ).toISOString(),
  }
  await validateInvitationIntent(tx, intent, recipient)
  return intent
}

export async function validateInvitationIntent(
  tx: Prisma.TransactionClient,
  intent: StoredInvitationIntent,
  recipient: string
): Promise<void> {
  await lockInvitationOrg(tx, intent.organizationId, true)
  await managedInvitationOwner(tx, intent.organizationId, intent.inviteId)
  await currentInvitationIntent(tx, intent.inviteId, intent.organizationId, true)
  const invite = await lockInvitation(tx, intent.inviteId, intent.organizationId)
  const continuation = await tx.invitationContinuation.findUnique({
    where: { credentialHash: intent.credentialHash },
  })
  const now = await mfaDatabaseClock(tx)
  if (
    !invite ||
    !continuation ||
    continuation.inviteId !== invite.id ||
    continuation.generation !== intent.generation ||
    continuation.expiresAt <= now ||
    new Date(intent.expiresAt) <= now ||
    invite.generation !== intent.generation ||
    invite.emailCanonical !== recipient ||
    recipient !== intent.recipient ||
    invite.intentInvalid ||
    invite.acceptedAt ||
    invite.revokedAt ||
    invite.expiresAt <= now
  )
    throw invalidInvitation()
}
