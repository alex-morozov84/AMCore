import { Injectable } from '@nestjs/common'

import type { WorkCommand, WorkReason } from '@amcore/shared'

import { AiRunService } from '../runs/ai-run.service'

import { AiWorkCleanup } from './ai-work-cleanup'
import { aiRunBasicCapability, aiRunRevision, aiWorkDigest } from './ai-work-policy'
import { AiWorkRetry } from './ai-work-retry'

import { type AiRun, Prisma } from '@/generated/prisma/client'
import type {
  DurableControlState,
  DurableOutcome,
  DurableTransactionContext,
  DurableWorkControl,
} from '@/infrastructure/background-work'

interface BusinessState {
  gate?: { paused: boolean; revision: number }
  rows: AiRun[]
  refusals: Map<string, WorkReason>
  prepared: Map<string, { availableAt: Date; deadlineAt: Date }>
}

@Injectable()
export class AiWorkControl implements DurableWorkControl {
  constructor(
    private readonly runs: AiRunService,
    private readonly retry: AiWorkRetry,
    private readonly cleanup: AiWorkCleanup
  ) {}

  async lock(ctx: DurableTransactionContext, command: WorkCommand): Promise<DurableControlState> {
    await ctx.tx.$queryRaw`SELECT set_config('lock_timeout', '500ms', true)`
    if (command.operation === 'pause' || command.operation === 'resume') {
      const [gate] = await ctx.tx.$queryRaw<{ paused: boolean; revision: number }[]>`
        SELECT paused, revision FROM ai.ai_run_control WHERE id = 1 FOR UPDATE`
      if (!gate) throw new Error('ai_run_claim_authority_missing')
      return {
        targets: [
          {
            id: command.workId,
            snapshot: { revision: aiWorkDigest([gate.paused, gate.revision]) },
          },
        ],
        businessState: {
          gate,
          rows: [],
          refusals: new Map(),
          prepared: new Map(),
        } satisfies BusinessState,
      }
    }
    const ids = command.targets.map((target) => target.id).sort()
    const initial = await ctx.tx.aiRun.findMany({
      where: { id: { in: ids } },
      select: { id: true, conversationId: true, inputMessageId: true },
    })
    if (command.operation === 'retry' || command.operation === 'cleanup') {
      const conversations = [...new Set(initial.map((row) => row.conversationId))].sort()
      if (conversations.length)
        await ctx.tx.$queryRaw(Prisma.sql`
        SELECT id FROM ai.ai_conversations
        WHERE id IN (${Prisma.join(conversations)}) ORDER BY id FOR UPDATE`)
    }
    if (ids.length)
      await ctx.tx.$queryRaw(Prisma.sql`
      SELECT id FROM ai.ai_runs WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
    const rows = await ctx.tx.aiRun.findMany({ where: { id: { in: ids } } })
    if (command.operation === 'retry' || command.operation === 'cleanup') {
      const messageIds = [
        ...new Set(rows.flatMap((row) => (row.inputMessageId ? [row.inputMessageId] : []))),
      ].sort()
      if (messageIds.length)
        await ctx.tx.$queryRaw(Prisma.sql`
        SELECT id FROM ai.ai_messages WHERE id IN (${Prisma.join(messageIds)})
        ORDER BY id FOR UPDATE`)
    }
    const [clock] = await ctx.tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    ctx.now = clock!.now
    const refusals = new Map<string, WorkReason>()
    const prepared = new Map<string, { availableAt: Date; deadlineAt: Date }>()
    for (const row of rows) {
      if (command.operation === 'retry') {
        const check = await this.retry.check(ctx.tx, row, ctx.now)
        if (check.reason) refusals.set(row.id, check.reason)
        else prepared.set(row.id, check.prepared!)
      }
      if (command.operation === 'cleanup') {
        const reason = await this.cleanup.check(ctx.tx, row, ctx.now, ctx.commandId)
        if (reason) refusals.set(row.id, reason)
      }
    }
    return {
      targets: command.targets.map((target) => {
        const row = rows.find((item) => item.id === target.id)
        return {
          id: target.id,
          incarnation: row?.incarnation ?? target.incarnation,
          snapshot: { revision: row ? aiRunRevision(row) : target.revision },
        }
      }),
      businessState: { rows, refusals, prepared } satisfies BusinessState,
    }
  }

  eligibility(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): WorkReason | null {
    const state = locked.businessState as BusinessState
    if (state.gate) {
      if (aiWorkDigest([state.gate.paused, state.gate.revision]) !== command.expectedWorkRevision)
        return 'STATE_CHANGED'
      return state.gate.paused === (command.operation === 'pause') ? 'ALREADY_IN_STATE' : null
    }
    const target = command.targets[0]
    const row = state.rows.find((item) => item.id === target?.id)
    if (!row) return 'HISTORY_EXPIRED'
    if (row.incarnation !== target?.incarnation || aiRunRevision(row) !== target.revision)
      return 'STATE_CHANGED'
    return state.refusals.get(row.id) ?? aiRunBasicCapability(row, command.operation, ctx.now)
  }

  async apply(
    ctx: DurableTransactionContext,
    locked: DurableControlState,
    command: WorkCommand
  ): Promise<ReadonlyMap<string, DurableOutcome>> {
    const state = locked.businessState as BusinessState
    const id = locked.targets[0]!.id
    const [clock] = await ctx.tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    ctx.now = clock!.now
    const reason = this.eligibility(ctx, locked, command)
    if (reason) return new Map([[id, { state: 'rejected', reason }]])
    if (state.gate) {
      await ctx.tx.aiRunControl.update({
        where: { id: 1 },
        data: {
          paused: command.operation === 'pause',
          revision: { increment: 1 },
          updatedAt: ctx.now,
        },
      })
      return new Map([[id, { state: 'applied' }]])
    }
    const row = state.rows.find((item) => item.id === id)!
    if (command.operation === 'cancel') await this.runs.cancelInTx(ctx.tx, id, ctx.principal.sub)
    if (command.operation === 'retry') {
      if (!row.deadlineAt || row.deadlineAt <= ctx.now)
        return new Map([[id, { state: 'rejected', reason: 'HORIZON_EXPIRED' }]])
      await this.retry.createChild(ctx.tx, row, state.prepared.get(id)!)
      await ctx.tx.aiRun.update({ where: { id }, data: { controlRevision: { increment: 1 } } })
    }
    if (command.operation === 'cleanup') {
      const cutoff = new Date(command.parameters.cutoff!)
      if (
        !command.parameters.states?.includes('completed') ||
        !row.finishedAt ||
        row.finishedAt > cutoff ||
        cutoff.getTime() > ctx.now.getTime() - 30 * 86400000
      )
        return new Map([[id, { state: 'rejected', reason: 'STATE_CHANGED' }]])
      const refusal = await this.cleanup.check(ctx.tx, row, ctx.now, ctx.commandId)
      if (refusal) return new Map([[id, { state: 'rejected', reason: refusal }]])
      await this.cleanup.remove(ctx.tx, row, ctx.principal.sub, ctx.commandId, ctx.now)
    }
    return new Map([[id, { state: 'applied' }]])
  }
}
