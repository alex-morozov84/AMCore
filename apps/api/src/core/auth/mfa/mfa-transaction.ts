import type { Prisma } from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/index.js'
import { sessionCoordinationLockKey } from '../session-lock-key.js'

/** Call after invitation/context locks; never acquire them after this helper. */
export async function lockMfaAccounts(
  tx: Prisma.TransactionClient,
  userIds: string[]
): Promise<Date> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  for (const id of [...new Set(userIds)].sort()) {
    await acquireXactLock(tx, sessionCoordinationLockKey(id))
  }
  return mfaDatabaseClock(tx)
}

/** Read after all relevant locks, not before a potentially blocking acquisition. */
export async function mfaDatabaseClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  if (!clock) throw new Error('MFA transaction clock unavailable')
  return clock.now
}
