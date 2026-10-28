import { z } from 'zod'

import type { BrowserRevision } from '@amcore/shared'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'

import { liveMfaFlows } from './mfa-live-flows.js'

const timestamps = z.array(z.number().int().nonnegative()).max(10)
export interface AccountBudget {
  allowed: boolean
  retryAfter: number
  retained: number[]
}

/** Retain future entries when the DB clock moves backwards; never erase a budget on success. */
export function rollingBudget(
  values: unknown,
  limit: number,
  windowMs: number,
  now: Date
): AccountBudget {
  const parsed = timestamps.safeParse(values)
  if (!parsed.success) throw new ServiceUnavailableException('MFA account protection unavailable')
  const retained = parsed.data.filter((at) => at > now.getTime() - windowMs).sort((a, b) => a - b)
  const allowed = retained.length < limit
  return {
    allowed,
    retained,
    retryAfter: allowed
      ? 0
      : Math.max(1, Math.ceil((retained[0]! + windowMs - now.getTime()) / 1000)),
  }
}

/** Caller holds the account coordination lock; malformed stored data fails closed. */
export async function readFailureBudget(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date
): Promise<AccountBudget> {
  const row = await tx.mfaAttemptBudget.findUnique({ where: { userId } })
  return rollingBudget(row?.failures ?? [], 10, 900_000, now)
}

/** A negative outcome must COMMIT before the controller maps it to an error response. */
export async function recordFactorFailure(
  tx: Prisma.TransactionClient,
  flowId: string,
  userId: string,
  budget: AccountBudget,
  now: Date
): Promise<void> {
  if (!budget.allowed) throw new Error('Cannot charge an exhausted MFA budget')
  const failures = [...budget.retained, now.getTime()].sort((a, b) => a - b).slice(-10)
  await tx.mfaAttemptBudget.upsert({
    where: { userId },
    create: { userId, failures },
    update: { failures },
  })
  const flow = await tx.mfaFlow.update({
    where: { id: flowId },
    data: { attempts: { increment: 1 } },
  })
  if (flow.attempts >= 5) {
    await tx.mfaFlow.update({ where: { id: flowId }, data: { state: 'attempts_exhausted' } })
  }
}

/** Does not evict another device's flow or extend any existing absolute deadline. */
export async function chargeFlowStart(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  replacing?: BrowserRevision
): Promise<AccountBudget> {
  const row = await tx.mfaAttemptBudget.findUnique({ where: { userId } })
  const budget = rollingBudget(row?.starts ?? [], 5, 600_000, now)
  if (!budget.allowed) return budget
  const live = await liveMfaFlows(tx, userId, now, replacing)
  if (live.length >= 3)
    return {
      ...budget,
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((live[0]!.expiresAt.getTime() - now.getTime()) / 1000)),
    }
  await persistStartCharge(tx, userId, budget, now)
  return budget
}

/** Regeneration shares start debt, but does not create another live flow or evict one. */
export async function chargeDraftRegeneration(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date
): Promise<AccountBudget> {
  const row = await tx.mfaAttemptBudget.findUnique({ where: { userId } })
  const budget = rollingBudget(row?.starts ?? [], 5, 600_000, now)
  if (budget.allowed) await persistStartCharge(tx, userId, budget, now)
  return budget
}

async function persistStartCharge(
  tx: Prisma.TransactionClient,
  userId: string,
  budget: AccountBudget,
  now: Date
): Promise<void> {
  const starts = [...budget.retained, now.getTime()].sort((a, b) => a - b).slice(-5)
  await tx.mfaAttemptBudget.upsert({
    where: { userId },
    create: { userId, starts },
    update: { starts },
  })
}
