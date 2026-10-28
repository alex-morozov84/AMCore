import type { Prisma } from '../../../generated/prisma/client.js'

import type { FlowRequest } from './mfa-flow-lock.js'
import {
  lockPublicationContinuation,
  type PublicationContinuation,
} from './mfa-publication-continuation.js'

export interface PublicationStatus {
  state: 'pending' | 'published' | 'expired' | 'retired' | 'changed'
  familyId?: string
}

function status(current: PublicationContinuation): PublicationStatus {
  const { family, session, handoff, context, now } = current
  if (
    family.revokedAt ||
    session.revokedAt ||
    family.expiresAt <= now ||
    session.expiresAt <= now ||
    (handoff && handoff.status === 'aborted')
  )
    return { state: 'retired', familyId: family.id }
  if (family.publicationState === 'published') {
    return (!context || context.state === 'published') &&
      (!handoff || handoff.status === 'confirmed')
      ? { state: 'published', familyId: family.id }
      : { state: 'changed' }
  }
  if (
    family.publicationState !== 'pending' ||
    (context && context.state !== 'reserved') ||
    (handoff && handoff.status !== 'pending')
  )
    return { state: 'changed' }
  return !family.publicationDeadline ||
    family.publicationDeadline <= now ||
    (handoff && handoff.deadline <= now)
    ? { state: 'expired', familyId: family.id }
    : { state: 'pending', familyId: family.id }
}

/** Read-only after response loss: no credentials, cookie recovery, proof renewal or mutation replay. */
export async function publicationStatus(
  tx: Prisma.TransactionClient,
  request: FlowRequest,
  operationId: string
): Promise<PublicationStatus> {
  const current = await lockPublicationContinuation(tx, request, operationId)
  return current ? status(current) : { state: 'changed' }
}

/** Compensation retires only this still-current unpublished candidate. Published results require explicit logout. */
export async function retirePublication(
  tx: Prisma.TransactionClient,
  request: FlowRequest,
  operationId: string
): Promise<PublicationStatus> {
  const current = await lockPublicationContinuation(tx, request, operationId)
  if (!current) return { state: 'changed' }
  const existing = status(current)
  if (current.family.publicationState !== 'pending' || existing.state === 'changed') return existing
  const { flow, family, session, context, handoff, now } = current
  await tx.authSessionFamily.update({
    where: { id: family.id },
    data: { revokedAt: family.revokedAt ?? now, publicationState: 'retired' },
  })
  await tx.session.updateMany({
    where: { familyId: family.id, userId: flow.userId, revokedAt: null },
    data: { revokedAt: now, revocationReason: 'publication-retired' },
  })
  if (handoff?.status === 'pending')
    await tx.invitationAuthHandoff.update({
      where: { attemptId: handoff.attemptId },
      data: { status: 'aborted', settledAt: now },
    })
  await tx.mfaFlow.update({ where: { id: flow.id }, data: { state: 'retired' } })
  // Generation stays fenced by the retired flow/family; this is compensation, not a new login intent.
  if (context)
    await tx.browserAuthContext.update({
      where: { id: context.id },
      data: {
        state: 'logged_out',
        currentFamilyId: null,
        reservedFlowId: null,
        stagedBindingHash: null,
      },
    })
  return { state: 'retired', familyId: session.familyId }
}
