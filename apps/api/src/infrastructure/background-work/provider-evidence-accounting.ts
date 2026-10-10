import { lockControlBudget } from './control-budget-store'
import { CONTROL_LIMITS } from './control-limits'
import type { ControlTransaction } from './control-transaction'
import { WorkPolicyError } from './work-policy-error'

import type { BackgroundBudget } from '@/generated/prisma/client'

export interface EvidenceBudgets {
  readonly global: BackgroundBudget
  readonly work: BackgroundBudget
}

/** Automatic provider work pays its own finite safety quota, never ADMIN actor/request costs. */
export async function lockEvidenceBudgets(
  ctx: ControlTransaction,
  workId: string
): Promise<EvidenceBudgets> {
  return {
    global: await lockControlBudget(ctx, 'global'),
    work: await lockControlBudget(ctx, `work:${workId}`),
  }
}

export async function reserveEvidenceRow(
  ctx: ControlTransaction,
  rows: EvidenceBudgets
): Promise<void> {
  const limits = CONTROL_LIMITS.evidence
  if (
    rows.global.evidenceRows >= limits.globalRows ||
    rows.work.evidenceRows >= limits.workRows ||
    rows.global.evidenceBytes + BigInt(limits.rowBytes) > BigInt(limits.globalBytes) ||
    rows.work.evidenceBytes + BigInt(limits.rowBytes) > BigInt(limits.workBytes)
  )
    throw new WorkPolicyError('STORAGE_LIMIT')
  for (const row of [rows.global, rows.work]) {
    await ctx.tx.backgroundBudget.update({
      where: { key: row.key },
      data: {
        evidenceRows: { increment: 1 },
        evidenceBytes: { increment: limits.rowBytes },
      },
    })
    row.evidenceRows += 1
    row.evidenceBytes += BigInt(limits.rowBytes)
  }
}

export async function changeUnresolvedEvidence(
  ctx: ControlTransaction,
  rows: EvidenceBudgets,
  delta: 1 | -1
): Promise<void> {
  const limits = CONTROL_LIMITS.evidence
  if (
    delta === 1 &&
    (rows.global.unresolvedRows >= limits.globalUnresolved ||
      rows.work.unresolvedRows >= limits.workUnresolved)
  )
    throw new WorkPolicyError('STORAGE_LIMIT')
  for (const row of [rows.global, rows.work]) {
    if (row.unresolvedRows + delta < 0) throw new WorkPolicyError('INCONSISTENT_STATE')
    await ctx.tx.backgroundBudget.update({
      where: { key: row.key },
      data: { unresolvedRows: { increment: delta } },
    })
    row.unresolvedRows += delta
  }
}

/** Definitive evidence only; protected uncertainty never refunds its reserved storage. */
export async function removeEvidenceRow(
  ctx: ControlTransaction,
  rows: EvidenceBudgets,
  bytes: number
): Promise<void> {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > CONTROL_LIMITS.evidence.rowBytes)
    throw new WorkPolicyError('INCONSISTENT_STATE')
  for (const row of [rows.global, rows.work]) {
    if (row.evidenceRows < 1 || row.evidenceBytes < BigInt(bytes))
      throw new WorkPolicyError('INCONSISTENT_STATE')
    await ctx.tx.backgroundBudget.update({
      where: { key: row.key },
      data: {
        evidenceRows: { decrement: 1 },
        evidenceBytes: { decrement: bytes },
      },
    })
  }
}

/** Compaction refunds only counted logical bytes, never rows or possible-call capacity. */
export async function compactEvidenceAccounting(
  ctx: ControlTransaction,
  rows: EvidenceBudgets,
  previousBytes: number,
  compactBytes: number
): Promise<void> {
  if (
    previousBytes !== CONTROL_LIMITS.evidence.rowBytes ||
    compactBytes < 1 ||
    compactBytes > CONTROL_LIMITS.compactUnknownBytes
  )
    throw new WorkPolicyError('INCONSISTENT_STATE')
  const delta = BigInt(previousBytes - compactBytes)
  for (const row of [rows.global, rows.work]) {
    if (row.evidenceRows < 1 || row.evidenceBytes < BigInt(previousBytes))
      throw new WorkPolicyError('INCONSISTENT_STATE')
    await ctx.tx.backgroundBudget.update({
      where: { key: row.key },
      data: { evidenceBytes: { decrement: delta } },
    })
    row.evidenceBytes -= delta
  }
}
