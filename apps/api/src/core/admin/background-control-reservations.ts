import { Injectable } from '@nestjs/common'

import type { LockedControlBudgets } from './background-control-budgets'
import { backgroundControlError } from './background-control-error'

import type { BackgroundBudget } from '@/generated/prisma/client'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'
import type { ControlTransaction } from '@/infrastructure/background-work/control-transaction'

/** Active targets reserve possible-unknown capacity before any dispatch, never by eviction. */
@Injectable()
export class BackgroundControlReservations {
  async reserve(
    ctx: ControlTransaction,
    rows: LockedControlBudgets,
    commandBytes: number,
    targets: number
  ): Promise<void> {
    if (
      !rows.work ||
      !rows.actorWork ||
      !Number.isSafeInteger(commandBytes) ||
      commandBytes < 1 ||
      commandBytes > CONTROL_LIMITS.commandBytes ||
      !Number.isSafeInteger(targets) ||
      targets < 1 ||
      targets > CONTROL_LIMITS.batchTargets
    )
      throw backgroundControlError('CONTENT_UNSUPPORTED')
    const bytes = BigInt(commandBytes + targets * CONTROL_LIMITS.targetBytes)
    if (
      rows.global.commands + 1 > CONTROL_LIMITS.ledgerCommands ||
      rows.global.targets + targets > CONTROL_LIMITS.ledgerTargets ||
      rows.global.logicalBytes + bytes > BigInt(CONTROL_LIMITS.ledgerBytes)
    )
      throw backgroundControlError('STORAGE_LIMIT')
    for (const scope of ['global', 'actor', 'work'] as const) {
      const row = rows[scope]!
      const active = CONTROL_LIMITS.active[scope]
      if (
        row.activeCommands + 1 > active.commands ||
        row.activeTargets + targets > active.targets ||
        row.unknownTargets + targets > CONTROL_LIMITS.unknown[scope]
      )
        throw backgroundControlError('LIMIT_REACHED')
    }
    for (const row of [rows.global, rows.actor, rows.work, rows.actorWork]) {
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: {
          commands: { increment: 1 },
          targets: { increment: targets },
          logicalBytes: { increment: bytes },
          activeCommands: { increment: 1 },
          activeTargets: { increment: targets },
          unknownTargets: { increment: targets },
        },
      })
      row.commands += 1
      row.targets += targets
      row.logicalBytes += bytes
      row.activeCommands += 1
      row.activeTargets += targets
      row.unknownTargets += targets
    }
  }

  async releaseTarget(ctx: ControlTransaction, rows: LockedControlBudgets): Promise<void> {
    for (const row of this.all(rows)) {
      if (row.activeTargets < 1 || row.unknownTargets < 1)
        throw backgroundControlError('INCONSISTENT_STATE')
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: {
          activeTargets: { decrement: 1 },
          unknownTargets: { decrement: 1 },
        },
      })
      row.activeTargets -= 1
      row.unknownTargets -= 1
    }
  }

  async releaseCommand(ctx: ControlTransaction, rows: LockedControlBudgets): Promise<void> {
    for (const row of this.all(rows)) {
      if (row.activeCommands < 1) throw backgroundControlError('INCONSISTENT_STATE')
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: { activeCommands: { decrement: 1 } },
      })
      row.activeCommands -= 1
    }
  }

  /** A settlement barrier releases execution capacity, never the protected unknown reservation. */
  async releaseUnknownExecution(
    ctx: ControlTransaction,
    rows: LockedControlBudgets
  ): Promise<void> {
    for (const row of this.all(rows)) {
      if (row.activeTargets < 1 || row.unknownTargets < 1)
        throw backgroundControlError('INCONSISTENT_STATE')
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: { activeTargets: { decrement: 1 } },
      })
      row.activeTargets -= 1
    }
  }

  /** Storage removal refunds retained bytes/rows only, never spent admission or execution budgets. */
  async removeReceipt(
    ctx: ControlTransaction,
    rows: LockedControlBudgets,
    commandBytes: number,
    targets: number,
    targetBytes: number
  ): Promise<void> {
    const bytes = BigInt(commandBytes + targetBytes)
    if (targets < 1 || targets > CONTROL_LIMITS.batchTargets || bytes < 1n)
      throw backgroundControlError('INCONSISTENT_STATE')
    for (const row of this.all(rows)) {
      if (row.commands < 1 || row.targets < targets || row.logicalBytes < bytes)
        throw backgroundControlError('INCONSISTENT_STATE')
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: {
          commands: { decrement: 1 },
          targets: { decrement: targets },
          logicalBytes: { decrement: bytes },
        },
      })
    }
  }

  private all(rows: LockedControlBudgets): BackgroundBudget[] {
    if (!rows.work || !rows.actorWork) throw backgroundControlError('INCONSISTENT_STATE')
    return [rows.global, rows.actor, rows.work, rows.actorWork]
  }

  /** Protected rows and execution/unknown reservations survive compaction. */
  async compactBytes(
    ctx: ControlTransaction,
    rows: LockedControlBudgets,
    bytes: number
  ): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 1)
      throw backgroundControlError('INCONSISTENT_STATE')
    for (const row of this.all(rows)) {
      if (row.logicalBytes < BigInt(bytes)) throw backgroundControlError('INCONSISTENT_STATE')
      await ctx.tx.backgroundBudget.update({
        where: { key: row.key },
        data: { logicalBytes: { decrement: bytes } },
      })
      row.logicalBytes -= BigInt(bytes)
    }
  }
}
