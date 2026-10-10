import { Inject, Injectable, Optional } from '@nestjs/common'

import type { WorkOperation } from '@amcore/shared'

import { backgroundControlError } from './background-control-error'

import type { BackgroundBudget, Prisma } from '@/generated/prisma/client'
import { admitControlBudget, type GcraRate } from '@/infrastructure/background-work/control-budget'
import { lockControlBudget } from '@/infrastructure/background-work/control-budget-store'
import { CONTROL_LIMITS, CONTROL_RATES } from '@/infrastructure/background-work/control-limits'
import type { ControlTransaction } from '@/infrastructure/background-work/control-transaction'
import { WORK_REGISTRATIONS } from '@/infrastructure/background-work/registration'
import type { WorkRegistration } from '@/infrastructure/background-work/work-definition'
import { WorkPolicyError } from '@/infrastructure/background-work/work-policy-error'

export interface LockedControlBudgets {
  readonly global: BackgroundBudget
  readonly actor: BackgroundBudget
  readonly work?: BackgroundBudget
  readonly actorWork?: BackgroundBudget
}

/** Lock order is global → actor → work → actor/work; no Redis/local authorization fallback. */
@Injectable()
export class BackgroundControlBudgets {
  constructor(
    @Optional()
    @Inject(WORK_REGISTRATIONS)
    private readonly entries: readonly WorkRegistration[] = []
  ) {}

  /** Code-owned per-work slots only; arbitrary rejected work IDs share one slot. */
  async denialAudit(
    ctx: ControlTransaction,
    actor: BackgroundBudget,
    workId: string
  ): Promise<boolean> {
    const slot = this.entries.some((entry) => entry.definition.id === workId) ? workId : 'unknown'
    const clocks = this.parseClocks(actor.virtualTime)
    const field = `denial:${slot}`
    const now = ctx.now.getTime()
    if ((clocks[field] ?? 0) > now) return false
    clocks[field] = now + 60000
    await ctx.tx.backgroundBudget.update({
      where: { key: actor.key },
      data: { virtualTime: clocks, lastObservedTime: ctx.now },
    })
    return true
  }

  async lock(
    ctx: ControlTransaction,
    actorId: string,
    workId?: string
  ): Promise<LockedControlBudgets> {
    const global = await this.lockRow(ctx, 'global')
    const actor = await this.lockActorRow(ctx, global, `actor:${actorId}`)
    if (!workId) return { global, actor }
    const work = await this.lockRow(ctx, `work:${workId}`)
    const actorWork = await this.lockActorRow(ctx, global, `actor-work:${actorId}:${workId}`)
    return { global, actor, work, actorWork }
  }

  async request(ctx: ControlTransaction, rows: LockedControlBudgets, read: boolean): Promise<void> {
    await this.consume(
      ctx,
      rows.global,
      read ? 'reads' : 'requests',
      read ? CONTROL_RATES.globalReads : CONTROL_RATES.globalRequests,
      1
    )
    await this.consume(
      ctx,
      rows.actor,
      read ? 'reads' : 'requests',
      read ? CONTROL_RATES.actorReads : CONTROL_RATES.actorRequests,
      1
    )
  }

  async targets(
    ctx: ControlTransaction,
    rows: LockedControlBudgets,
    count: number,
    operation: WorkOperation
  ): Promise<void> {
    if (!rows.actorWork || !rows.work || count < 1 || count > CONTROL_LIMITS.batchTargets)
      throw backgroundControlError('CONTENT_UNSUPPORTED')
    await this.consume(ctx, rows.global, 'targets', CONTROL_RATES.globalTargets, count)
    await this.consume(ctx, rows.actorWork, 'targets', CONTROL_RATES.actorWorkTargets, count)
    if (operation === 'pause' || operation === 'resume')
      await this.consume(ctx, rows.actor, 'pause', CONTROL_RATES.actorPause, 1)
  }

  private async lockRow(ctx: ControlTransaction, key: string): Promise<BackgroundBudget> {
    try {
      return await lockControlBudget(ctx, key)
    } catch (error) {
      if (error instanceof WorkPolicyError) throw backgroundControlError(error.reason)
      throw error
    }
  }

  private async lockActorRow(
    ctx: ControlTransaction,
    global: BackgroundBudget,
    key: string
  ): Promise<BackgroundBudget> {
    const existing = await ctx.tx.backgroundBudget.findUnique({
      where: { key },
      select: { key: true },
    })
    if (!existing) {
      if (global.actorBudgetRows >= CONTROL_LIMITS.actorBudgetRows)
        throw backgroundControlError('STORAGE_LIMIT')
      await ctx.tx.backgroundBudget.update({
        where: { key: global.key },
        data: { actorBudgetRows: { increment: 1 } },
      })
      global.actorBudgetRows += 1
    }
    return this.lockRow(ctx, key)
  }

  private async consume(
    ctx: ControlTransaction,
    row: BackgroundBudget,
    field: string,
    rate: GcraRate,
    cost: number
  ): Promise<void> {
    const clocks = this.parseClocks(row.virtualTime)
    const decision = admitControlBudget(clocks[field] ?? 0, ctx.now.getTime(), rate, cost)
    if (!decision.accepted)
      throw backgroundControlError('RATE_LIMIT_EXCEEDED', decision.retryAfterMs)
    clocks[field] = decision.virtualTime
    await ctx.tx.backgroundBudget.update({
      where: { key: row.key },
      data: { virtualTime: clocks, lastObservedTime: ctx.now },
    })
    row.virtualTime = clocks
  }

  private parseClocks(value: Prisma.JsonValue): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw backgroundControlError('CLOCK_UNCERTAIN')
    const result: Record<string, number> = {}
    for (const [key, clock] of Object.entries(value)) {
      const denialSlot =
        key.startsWith('denial:') &&
        (key === 'denial:unknown' ||
          this.entries.some((entry) => key === `denial:${entry.definition.id}`))
      if (
        (!['requests', 'targets', 'pause', 'reads'].includes(key) && !denialSlot) ||
        typeof clock !== 'number' ||
        !Number.isSafeInteger(clock) ||
        clock < 0
      )
        throw backgroundControlError('CLOCK_UNCERTAIN')
      result[key] = clock
    }
    return result
  }
}
