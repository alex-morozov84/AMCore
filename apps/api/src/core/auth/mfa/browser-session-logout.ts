import type { BrowserAuthContext, Prisma } from '../../../generated/prisma/client.js'
import type { PrismaService } from '../../../prisma/index.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { matchesBrowserRevision } from './browser-context.repository.js'
import { browserLoginParticipants } from './browser-login-participants.js'
import { refreshSessionChanged } from './mfa-refresh-authority.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

/** Retires only the actual browser generation, including its unfinished independent sign-in. */
export async function logoutBrowserSession(
  db: PrismaService,
  binding: BrowserRequestBinding,
  refreshHash?: string
): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const { context, familyIds, now } = await lockLogout(tx, binding)
      if (refreshHash) await assertSelectedRefresh(tx, context, refreshHash)
      await retireGeneration(tx, context, familyIds, now)
    },
    { maxWait: 2000, timeout: 4000 }
  )
}

export async function lockLogout(
  tx: Prisma.TransactionClient,
  binding: BrowserRequestBinding
): Promise<{ context: BrowserAuthContext; familyIds: string[]; now: Date }> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${binding.contextId} FOR UPDATE`
  const context = await tx.browserAuthContext.findUnique({ where: { id: binding.contextId } })
  const now = await mfaDatabaseClock(tx)
  if (
    !matchesBrowserRevision(context, binding, now) ||
    context.bindingHash !== binding.bindingHash ||
    context.audience !== binding.audience ||
    context.generation >= 2147483647
  )
    throw refreshSessionChanged()
  const participants = await browserLoginParticipants(tx, context)
  if (!participants) throw refreshSessionChanged()
  const finalNow = await lockMfaAccounts(tx, participants.owners)
  if (context.expiresAt <= finalNow) throw refreshSessionChanged()
  return { context, familyIds: participants.familyIds, now: finalNow }
}

export async function retireGeneration(
  tx: Prisma.TransactionClient,
  context: BrowserAuthContext,
  familyIds: string[],
  now: Date
): Promise<BrowserAuthContext> {
  await tx.mfaFlow.updateMany({
    where: {
      browserContextId: context.id,
      publicationGeneration: context.generation,
      state: { in: ['open', 'committed'] },
    },
    data: { state: 'retired' },
  })
  await tx.authSessionFamily.updateMany({
    where: { id: { in: familyIds }, revokedAt: null },
    data: { revokedAt: now, publicationState: 'retired' },
  })
  await tx.session.updateMany({
    where: { familyId: { in: familyIds }, revokedAt: null },
    data: { revokedAt: now, revocationReason: 'browser-logout' },
  })
  return tx.browserAuthContext.update({
    where: { id: context.id, generation: context.generation },
    data: {
      generation: { increment: 1 },
      state: 'logged_out',
      currentFamilyId: null,
      reservedFlowId: null,
      stagedBindingHash: null,
    },
  })
}

export async function assertSelectedRefresh(
  tx: Prisma.TransactionClient,
  context: BrowserAuthContext,
  refreshHash: string
): Promise<void> {
  const session = await tx.session.findUnique({ where: { refreshToken: refreshHash } })
  if (!session || session.familyId !== context.currentFamilyId) throw refreshSessionChanged()
  const family = await tx.authSessionFamily.findUnique({ where: { id: session.familyId } })
  if (
    !family ||
    family.userId !== session.userId ||
    family.browserContextId !== context.id ||
    family.publicationGeneration !== context.generation
  )
    throw refreshSessionChanged()
}
