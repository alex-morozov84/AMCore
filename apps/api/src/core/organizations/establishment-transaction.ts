import { acquireXactLock } from '../../prisma/advisory-lock'

import type { Prisma, PrismaClient } from '@/generated/prisma/client'

export type EstablishmentDatabase = Pick<PrismaClient, '$transaction'>
export type EstablishmentTx = Prisma.TransactionClient

export function establishmentTransaction<T>(
  db: EstablishmentDatabase,
  work: (tx: EstablishmentTx) => Promise<T>
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`
      await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`
      return work(tx)
    },
    { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 4000 }
  )
}

/** Lock before eligibility or target rows; ordinary INSERT writers conflict here. */
export async function lockInitialSetup(
  tx: EstablishmentTx,
  consoleOperator: boolean
): Promise<void> {
  if (consoleOperator) await acquireXactLock(tx, 'system-role:SUPER_ADMIN')
  await acquireXactLock(tx, 'initial-organization-setup')
  await tx.$executeRaw`LOCK TABLE core.organizations IN SHARE ROW EXCLUSIVE MODE`
}
