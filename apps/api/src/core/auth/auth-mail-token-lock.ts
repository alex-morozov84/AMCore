import type { Prisma } from '../../generated/prisma/client.js'
import { acquireXactLock } from '../../prisma/index.js'

export async function lockAuthMailTokens(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await acquireXactLock(tx, `auth-mail-token:${userId}`)
}

/** Evaluated after lock waits; transaction-start now() is not an expiry authority. */
export async function authMailClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  if (!row) throw new Error('Auth mail clock unavailable')
  return row.now
}
