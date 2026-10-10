import { type ControlTransaction, sampleControlClock } from './control-transaction'
import { WorkPolicyError } from './work-policy-error'

import type { BackgroundBudget } from '@/generated/prisma/client'

/** Fixed quota-row authority shared by ADMIN accounting and provider-window safety admission. */
export async function lockControlBudget(
  ctx: ControlTransaction,
  key: string
): Promise<BackgroundBudget> {
  // Prisma may emulate an empty-update upsert as read/insert; concurrent cold
  // admission must not fail on the same authority key's first creation.
  await ctx.tx
    .$executeRaw`INSERT INTO core.background_budgets (key, "lastObservedTime", "updatedAt")
    VALUES (${key}, ${ctx.now}, ${ctx.now}) ON CONFLICT (key) DO NOTHING`
  await ctx.tx.$queryRaw`SELECT key FROM core.background_budgets WHERE key = ${key} FOR UPDATE`
  if (key === 'global') ctx.now = await sampleControlClock(ctx.tx)
  const row = await ctx.tx.backgroundBudget.findUniqueOrThrow({ where: { key } })
  if (ctx.now.getTime() < row.lastObservedTime.getTime())
    throw new WorkPolicyError('CLOCK_UNCERTAIN')
  return ctx.tx.backgroundBudget.update({ where: { key }, data: { lastObservedTime: ctx.now } })
}
