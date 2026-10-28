import type { BrowserAudience, BrowserRevision } from '@amcore/shared'

import type { BrowserAuthContext, Prisma } from '../../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { lockBrowserContext, matchesBrowserRevision } from './browser-context.repository.js'
import { browserLoginParticipants } from './browser-login-participants.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export interface LockedBrowserLogin {
  context: BrowserAuthContext
  targetUserId: string
  accountIds: string[]
}

async function lockParticipants(
  tx: Prisma.TransactionClient,
  context: BrowserAuthContext,
  expected: BrowserRevision,
  targetUserId: string
): Promise<LockedBrowserLogin | null> {
  const participants = await browserLoginParticipants(tx, context)
  if (!participants) return null
  const accountIds = [...new Set([targetUserId, ...participants.owners])].sort()
  const now = await lockMfaAccounts(tx, accountIds)
  return matchesBrowserRevision(context, expected, now)
    ? { context, targetUserId, accountIds }
    : null
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
  return lockParticipants(tx, context, expected, targetUserId)
}

/** Uses only the actual normalized request capability from the trusted BFF verifier. */
export async function lockBrowserLoginBinding(
  tx: Prisma.TransactionClient,
  binding: BrowserRequestBinding,
  targetUserId: string
): Promise<LockedBrowserLogin | null> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${binding.contextId} FOR UPDATE`
  const context = await tx.browserAuthContext.findUnique({ where: { id: binding.contextId } })
  if (
    !matchesBrowserRevision(context, binding, await mfaDatabaseClock(tx)) ||
    context.bindingHash !== binding.bindingHash ||
    context.audience !== binding.audience
  )
    return null
  return lockParticipants(tx, context, binding, targetUserId)
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
  const participants = await browserLoginParticipants(tx, context)
  if (!participants || participants.owners.some((id) => !locked.accountIds.includes(id)))
    return null
  await tx.mfaFlow.updateMany({
    where: {
      browserContextId: context.id,
      publicationGeneration: context.generation,
      state: { in: ['open', 'committed'] },
      id: { not: reservationId },
    },
    data: { state: 'retired' },
  })
  if (participants.familyIds.length) {
    await tx.authSessionFamily.updateMany({
      where: { id: { in: participants.familyIds }, revokedAt: null },
      data: { revokedAt: now, publicationState: 'retired' },
    })
    await tx.session.updateMany({
      where: { familyId: { in: participants.familyIds }, revokedAt: null },
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
