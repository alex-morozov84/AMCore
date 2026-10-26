import type { Prisma } from '../../../generated/prisma/client.js'

import { mfaDatabaseClock } from './mfa-transaction.js'

/** Caller holds the user's session-coordination lock in the same transaction. */
export async function advanceAccountSecurity(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<number> {
  const now = await mfaDatabaseClock(tx)
  const account = await tx.mfaAccount.upsert({
    where: { userId },
    create: { userId, securityVersion: 1 },
    update: { securityVersion: { increment: 1 } },
  })
  await tx.authSessionFamily.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  })
  await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revocationReason: 'security-reset' },
  })
  await tx.mfaFlow.updateMany({
    where: { userId, state: 'open' },
    data: { state: 'retired' },
  })
  return account.securityVersion
}
