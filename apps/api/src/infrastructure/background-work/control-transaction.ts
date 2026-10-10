import { CONTROL_LIMITS } from './control-limits'

import type { Prisma } from '@/generated/prisma/client'
import type { PrismaService } from '@/prisma'

export interface ControlTransaction {
  readonly tx: Prisma.TransactionClient
  now: Date
}

/** Short primary-PG authority; callers never keep this transaction open across broker/transport I/O. */
export function backgroundControlTransaction<T>(
  prisma: PrismaService,
  action: (ctx: ControlTransaction) => Promise<T>,
  timeoutMs: number = CONTROL_LIMITS.transactionMs
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true),
      set_config('statement_timeout', '1000ms', true)`
      return action({ tx, now: await sampleControlClock(tx) })
    },
    { timeout: timeoutMs, maxWait: Math.min(timeoutMs, CONTROL_LIMITS.lockMs) }
  )
}

export async function sampleControlClock(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  const now = rows[0]?.now
  if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()))
    throw new Error('CLOCK_UNCERTAIN')
  return now
}
