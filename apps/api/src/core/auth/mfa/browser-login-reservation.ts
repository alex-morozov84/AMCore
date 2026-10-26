import type { BrowserAudience, BrowserRevision } from '@amcore/shared'

import type { BrowserAuthContext, Prisma } from '../../../generated/prisma/client.js'

import { lockBrowserContext, matchesBrowserRevision } from './browser-context.repository.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export interface LockedBrowserLogin {
  context: BrowserAuthContext
  targetUserId: string
}

/** Credential coordinator rechecks independent identity/password proof AFTER these locks. */
export async function lockBrowserLogin(
  tx: Prisma.TransactionClient,
  binding: string,
  audience: BrowserAudience,
  expected: BrowserRevision,
  targetUserId: string
): Promise<LockedBrowserLogin | null> {
  const context = await lockBrowserContext(tx, binding, audience)
  if (!matchesBrowserRevision(context, expected, await mfaDatabaseClock(tx))) return null
  const previous = context.currentFamilyId
    ? await tx.authSessionFamily.findUnique({
        where: { id: context.currentFamilyId },
        select: { userId: true },
      })
    : null
  const now = await lockMfaAccounts(tx, [targetUserId, ...(previous ? [previous.userId] : [])])
  return matchesBrowserRevision(context, expected, now) ? { context, targetUserId } : null
}

/**
 * Internal transaction effect, never capability-only authentication. The caller has
 * revalidated independent proof (or an exact committed replacement transfer).
 * Old pending flows/candidates become unusable through the primary generation fence.
 */
export async function reserveBrowserLogin(
  tx: Prisma.TransactionClient,
  locked: LockedBrowserLogin,
  expected: BrowserRevision,
  reservationId: string,
  expiresAt: Date
): Promise<BrowserAuthContext | null> {
  const now = await mfaDatabaseClock(tx)
  const { context } = locked
  if (
    !matchesBrowserRevision(context, expected, now) ||
    context.generation >= 2147483647 ||
    expiresAt <= now ||
    expiresAt.getTime() > now.getTime() + 900_000
  )
    return null
  if (context.currentFamilyId) {
    await tx.authSessionFamily.updateMany({
      where: { id: context.currentFamilyId, revokedAt: null },
      data: { revokedAt: now, publicationState: 'retired' },
    })
    await tx.session.updateMany({
      where: { familyId: context.currentFamilyId, revokedAt: null },
      data: { revokedAt: now, revocationReason: 'browser-superseded' },
    })
  }
  return tx.browserAuthContext.update({
    where: { id: context.id, generation: expected.generation },
    data: {
      generation: { increment: 1 },
      state: 'reserved',
      currentFamilyId: null,
      reservedFlowId: reservationId,
      stagedBindingHash: null,
      expiresAt,
    },
  })
}
