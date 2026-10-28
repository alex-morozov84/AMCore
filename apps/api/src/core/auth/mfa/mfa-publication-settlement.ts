import type { Prisma } from '../../../generated/prisma/client.js'

import { lockPublication, type PublicationCommand } from './mfa-publication-authority.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

/** Throwing forces the caller-owned transaction to roll back every pending publication effect. */
export class PublicationExpiredDuringCommit extends Error {}

/** One tx confirms invitation receipt AND publishes the exact family/context. Never accepts membership. */
export async function settlePublication(
  tx: Prisma.TransactionClient,
  command: PublicationCommand
): Promise<{ outcome: 'published' | 'changed' | 'unavailable' }> {
  const admission = await lockPublication(tx, command)
  if (admission.kind !== 'current') return { outcome: admission.kind }
  const { flow, context, family, session, handoff, alreadyPublished, now } = admission.value
  if (alreadyPublished) return { outcome: 'published' }
  await tx.user.update({ where: { id: family.userId }, data: { lastLoginAt: now } })
  if (handoff) {
    await tx.invitationAuthHandoff.update({
      where: { attemptId: handoff.attemptId },
      data: { status: 'confirmed', settledAt: now },
    })
  }
  await tx.authSessionFamily.update({
    where: { id: family.id },
    data: { publicationState: 'published' },
  })
  if (context) {
    await tx.browserAuthContext.update({
      where: { id: context.id },
      data: { state: 'published', currentFamilyId: family.id },
    })
  }
  await tx.mfaFlow.update({ where: { id: flow.id }, data: { state: 'completed' } })
  const finalNow = await mfaDatabaseClock(tx)
  if (
    !family.publicationDeadline ||
    family.publicationDeadline <= finalNow ||
    family.expiresAt <= finalNow ||
    session.expiresAt <= finalNow ||
    (context && context.expiresAt <= finalNow) ||
    (handoff && handoff.deadline <= finalNow)
  )
    throw new PublicationExpiredDuringCommit()
  return { outcome: 'published' }
}
