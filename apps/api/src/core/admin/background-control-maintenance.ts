import { Injectable, Optional } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { BackgroundCommandSettlement } from './background-command-settlement'
import { backgroundControlError } from './background-control-error'

import { lockControlBudget } from '@/infrastructure/background-work/control-budget-store'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'
import { backgroundControlTransaction } from '@/infrastructure/background-work/control-transaction'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'
import { PrismaService } from '@/prisma'

/** Worker-only bounded expiration; failed audit/commit leaves the original pending receipt visible. */
@Injectable()
export class BackgroundControlMaintenance {
  private running = false
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: BackgroundCommandSettlement,
    private readonly logger: PinoLogger,
    @Optional() private readonly evidence?: ProviderEvidenceStore
  ) {}

  @Interval(CONTROL_LIMITS.maintenance.intervalMs)
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    const until = performance.now() + CONTROL_LIMITS.maintenance.transactionMs
    try {
      for (let processed = 0; processed < CONTROL_LIMITS.maintenance.targets; processed += 1) {
        const remaining = Math.floor(until - performance.now())
        if (remaining < 2) break
        const changed = await backgroundControlTransaction(
          this.prisma,
          async (ctx) => {
            // Global serialization makes selection and later CAS safe across replicas.
            await lockControlBudget(ctx, 'global')
            const target = await ctx.tx.backgroundCommandTarget.findFirst({
              where: {
                resolution: 'none',
                OR: [
                  { state: 'prepared', command: { dispatchUntil: { lte: ctx.now } } },
                  { state: 'dispatching', dispatchUntil: { lte: ctx.now } },
                ],
              },
              orderBy: [{ dispatchUntil: 'asc' }, { commandId: 'asc' }, { targetId: 'asc' }],
              select: { actorId: true, commandId: true, targetId: true },
            })
            if (!target) return false
            await this.settlement.expire(ctx, target.actorId, target.commandId, target.targetId)
            return true
          },
          Math.floor(remaining / 2)
        )
        if (!changed) break
      }
      const remaining = Math.floor(until - performance.now())
      if (remaining >= 2)
        await backgroundControlTransaction(
          this.prisma,
          async (ctx) => {
            const global = await lockControlBudget(ctx, 'global')
            const cutoff = new Date(ctx.now.getTime() - CONTROL_LIMITS.retentionMs)
            const idle = await ctx.tx.backgroundBudget.findMany({
              where: {
                OR: [{ key: { startsWith: 'actor:' } }, { key: { startsWith: 'actor-work:' } }],
                updatedAt: { lte: cutoff },
                lastObservedTime: { lte: cutoff },
                commands: 0,
                targets: 0,
                logicalBytes: 0n,
                activeCommands: 0,
                activeTargets: 0,
                unknownTargets: 0,
                evidenceRows: 0,
                evidenceBytes: 0n,
                unresolvedRows: 0,
              },
              orderBy: [{ updatedAt: 'asc' }, { key: 'asc' }],
              take: CONTROL_LIMITS.maintenance.idleBudgets,
              select: { key: true },
            })
            if (!idle.length) return
            if (global.actorBudgetRows < idle.length)
              throw backgroundControlError('INCONSISTENT_STATE')
            await ctx.tx.backgroundBudget.deleteMany({
              where: { key: { in: idle.map((row) => row.key) } },
            })
            await ctx.tx.backgroundBudget.update({
              where: { key: global.key },
              data: { actorBudgetRows: { decrement: idle.length } },
            })
          },
          Math.floor(remaining / 2)
        )
      // The same elapsed tick budget covers retention; expiration cannot buy another unbounded phase.
      for (let removed = 0; removed < CONTROL_LIMITS.maintenance.ledgerTargets;) {
        const remaining = Math.floor(until - performance.now())
        if (remaining < 2) break
        const count = await backgroundControlTransaction(
          this.prisma,
          async (ctx) => {
            await lockControlBudget(ctx, 'global')
            const cutoff = new Date(ctx.now.getTime() - CONTROL_LIMITS.retentionMs)
            const compact = await ctx.tx.backgroundCommandTarget.findFirst({
              where: {
                state: 'unknown',
                logicalBytes: CONTROL_LIMITS.targetBytes,
                command: {
                  createdAt: { lte: cutoff },
                  targets: { none: { state: { in: ['prepared', 'dispatching'] } } },
                },
              },
              orderBy: [{ actorId: 'asc' }, { commandId: 'asc' }, { targetId: 'asc' }],
              select: { actorId: true, commandId: true },
            })
            if (compact)
              return this.settlement.compactUnknownReceipt(
                ctx,
                compact.actorId,
                compact.commandId,
                CONTROL_LIMITS.maintenance.ledgerTargets - removed
              )
            const command = await ctx.tx.backgroundCommand.findFirst({
              where: {
                finalizedAt: { lte: cutoff },
                targets: {
                  every: {
                    state: { in: ['applied', 'rejected', 'not_attempted'] },
                    finalizedAt: { lte: cutoff },
                  },
                },
              },
              orderBy: [{ finalizedAt: 'asc' }, { actorId: 'asc' }, { commandId: 'asc' }],
              select: { actorId: true, commandId: true },
            })
            if (!command) return 0
            return this.settlement.purgeReceipt(
              ctx,
              command.actorId,
              command.commandId,
              CONTROL_LIMITS.maintenance.ledgerTargets - removed
            )
          },
          Math.floor(remaining / 2)
        )
        if (!count) break
        removed += count
      }
      for (
        let processed = 0;
        this.evidence && processed < CONTROL_LIMITS.maintenance.evidence;
        processed += 1
      ) {
        const remaining = Math.floor(until - performance.now())
        if (remaining < 2) break
        const changed = await backgroundControlTransaction(
          this.prisma,
          async (ctx) => {
            await lockControlBudget(ctx, 'global')
            const compact = await ctx.tx.backgroundEffectEvidence.findFirst({
              where: {
                certainty: 'unknown',
                logicalBytes: CONTROL_LIMITS.evidence.rowBytes,
                unresolvedCount: { gt: 0 },
                createdAt: { lte: new Date(ctx.now.getTime() - CONTROL_LIMITS.retentionMs) },
              },
              orderBy: [{ createdAt: 'asc' }, { workId: 'asc' }, { incarnation: 'asc' }],
              select: { workId: true, incarnation: true },
            })
            if (compact)
              return this.evidence!.compactUnknown(ctx, compact.workId, compact.incarnation)
            const row = await ctx.tx.backgroundEffectEvidence.findFirst({
              where: {
                finalizedAt: { lte: new Date(ctx.now.getTime() - CONTROL_LIMITS.retentionMs) },
                certainty: { in: ['none', 'accepted'] },
                unresolvedCount: 0,
                outcomeRecorded: true,
                activeAttemptId: null,
                commandFence: null,
                disposition: 'none',
              },
              orderBy: [{ finalizedAt: 'asc' }, { workId: 'asc' }, { incarnation: 'asc' }],
              select: { workId: true, incarnation: true },
            })
            return row ? this.evidence!.purge(ctx, row.workId, row.incarnation) : false
          },
          Math.floor(remaining / 2)
        )
        if (!changed) break
      }
    } catch {
      // No retry loop or Redis dispatch. The next fixed tick observes durable state again.
      this.logger.warn(
        { code: 'BACKGROUND_CONTROL_MAINTENANCE_DEFERRED' },
        'Background control expiration deferred; pending receipts remain visible'
      )
    } finally {
      this.running = false
    }
  }
}
