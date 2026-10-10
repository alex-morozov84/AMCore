import { Injectable, type OnModuleInit } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import {
  type RequestPrincipal,
  type WorkCommand,
  workReasonSchema,
  type WorkReceipt,
  type WorkReconciliation,
  workReconciliationSchema,
} from '@amcore/shared'

import {
  BackgroundCommandAdmission,
  type CommandTargetSnapshot,
  type PreparedCommand,
} from './background-command-admission'
import { projectWorkReceipt } from './background-command-codec'
import { BackgroundCommandSettlement, type CommandOutcome } from './background-command-settlement'
import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets } from './background-control-budgets'
import { backgroundControlError } from './background-control-error'

import { AppException, NotFoundException } from '@/common/exceptions'
import type { BackgroundCommandTarget } from '@/generated/prisma/client'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'
import {
  backgroundControlTransaction,
  type ControlTransaction,
  sampleControlClock,
} from '@/infrastructure/background-work/control-transaction'
import type {
  DurableTransactionContext,
  DurableWorkControl,
} from '@/infrastructure/background-work/durable-work'
import { PgOutcomeBuffer } from '@/infrastructure/background-work/pg-outcome-buffer'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'
import { WorkPolicyError } from '@/infrastructure/background-work/work-policy-error'
import { PrismaService } from '@/prisma'

const witnessSchema = z.strictObject({
  actorId: z.string().min(1).max(64),
  commandId: z.uuidv7(),
  targetId: z.string().min(1).max(128),
  dispatchId: z.uuidv7(),
  outcome: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('applied') }),
    z.strictObject({ state: z.enum(['rejected', 'not_attempted']), reason: workReasonSchema }),
    z.strictObject({ state: z.literal('unknown') }),
  ]),
})

export interface BrokerCommandPort {
  observe(): Promise<readonly CommandTargetSnapshot[]>
  /** Called once after committed dispatch CAS. A transport exception is an unknown command. */
  dispatch(target: BackgroundCommandTarget): Promise<CommandOutcome>
  /** Policy-owned reservation after current PG authority, inside the same ADMIN intent transaction. */
  reserve?(
    ctx: ControlTransaction,
    observed: readonly CommandTargetSnapshot[]
  ): Promise<readonly CommandTargetSnapshot[]>
}

/** ADMIN command lifecycle; business execution and transport owners remain separate. */
@Injectable()
export class BackgroundCommandService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admission: BackgroundCommandAdmission,
    private readonly settlement: BackgroundCommandSettlement,
    private readonly authority: BackgroundControlAuthority,
    private readonly budgets: BackgroundControlBudgets,
    private readonly buffer: PgOutcomeBuffer
  ) {}

  onModuleInit(): void {
    this.buffer.register('command', async (payload) => {
      const witness = witnessSchema.parse(payload)
      await this.finalize(witness)
    })
  }

  async execute(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    port: BrokerCommandPort
  ): Promise<WorkReceipt> {
    await this.admission.chargeRequest(principal)
    const prepared = await this.prepare(principal, input, definitionVersion, port)
    if (!prepared.replay) {
      // Sequential dispatch keeps the batch bounded; each target has its own durable CAS/deadline.
      for (const target of prepared.targets)
        await this.dispatch(principal, input.commandId, target, port)
    }
    return this.receipt(principal, input.commandId)
  }

  /** Domain authority and target receipt/outcome audit share each short PG commit. */
  async executeDurable(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    adapter: DurableWorkControl
  ): Promise<WorkReceipt> {
    await this.admission.chargeRequest(principal)
    let prepared
    try {
      prepared = await this.admission.replay(principal, input, definitionVersion)
      if (!prepared)
        prepared = await backgroundControlTransaction(this.prisma, async (ctx) => {
          await this.budgets.lock(ctx, principal.sub, input.workId)
          await this.authority.assert(ctx, principal, true)
          const state = await adapter.lock(
            {
              ...ctx,
              principal,
              commandId: input.commandId,
              dispatchId: uuidv7(),
              dispatchNotAfter: new Date(ctx.now.getTime() + CONTROL_LIMITS.batchDeadlineMs),
            },
            input
          )
          return this.admission.prepare(
            ctx,
            principal,
            input,
            definitionVersion,
            state.targets,
            'durable'
          )
        })
    } catch (error) {
      if (error instanceof AppException)
        await this.admission.recordDenied(principal, input, definitionVersion, error)
      throw error
    }
    if (!prepared.replay)
      for (const target of prepared.targets)
        await this.dispatchDurable(principal, input, target, adapter)
    return this.receipt(principal, input.commandId)
  }

  private async dispatchDurable(
    principal: RequestPrincipal,
    input: WorkCommand,
    target: BackgroundCommandTarget,
    adapter: DurableWorkControl
  ): Promise<void> {
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      // Dispatch state is not independently committed: failure rolls back both
      // domain writes and receipt. Lost commit acknowledgement is recovered by GET.
      const dispatch = await this.settlement.beginDispatch(
        ctx,
        principal,
        input.commandId,
        target.targetId
      )
      if (!dispatch?.dispatchId) return
      const transaction: DurableTransactionContext = {
        ...ctx,
        principal,
        commandId: input.commandId,
        dispatchId: dispatch.dispatchId,
        dispatchNotAfter: dispatch.dispatchUntil!,
      }
      const command = {
        ...input,
        targets: input.targets.filter((row) => row.id === target.targetId),
      }
      const state = await adapter.lock(transaction, command)
      if (state.targets.length !== 1 || state.targets[0]!.id !== target.targetId)
        throw backgroundControlError('INCONSISTENT_STATE')
      const snapshot = state.targets[0]!
      const captured = target.snapshot as Record<string, unknown>
      const reason =
        snapshot.incarnation !== (target.incarnation ?? undefined) ||
        snapshot.snapshot.revision !== captured.revision
          ? 'STATE_CHANGED'
          : adapter.eligibility(transaction, state, command)
      transaction.now = await sampleControlClock(ctx.tx)
      let outcome: CommandOutcome
      if (transaction.now.getTime() >= transaction.dispatchNotAfter.getTime())
        outcome = { state: 'not_attempted', reason: 'COMMAND_EXPIRED' }
      else if (reason) outcome = { state: 'rejected', reason: workReasonSchema.parse(reason) }
      else {
        const applied = await adapter.apply(transaction, state, command)
        if (applied.size !== 1 || !applied.has(target.targetId))
          throw backgroundControlError('INCONSISTENT_STATE')
        const result = applied.get(target.targetId)!
        outcome =
          result.state === 'applied'
            ? { state: 'applied' }
            : { state: 'rejected', reason: workReasonSchema.parse(result.reason) }
      }
      await this.settlement.finalize(
        ctx,
        principal.sub,
        input.commandId,
        target.targetId,
        dispatch.dispatchId,
        outcome
      )
    })
  }

  private async prepare(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    port: BrokerCommandPort
  ): Promise<PreparedCommand> {
    try {
      const replay = await this.admission.replay(principal, input, definitionVersion)
      if (replay) return replay
      const observed = await port.observe()
      return await backgroundControlTransaction(this.prisma, async (ctx) => {
        if (!port.reserve)
          return this.admission.prepare(ctx, principal, input, definitionVersion, observed)
        await this.budgets.lock(ctx, principal.sub, input.workId)
        await this.authority.assert(ctx, principal, true)
        const targets = await port.reserve(ctx, observed)
        return this.admission.prepare(ctx, principal, input, definitionVersion, targets)
      })
    } catch (error) {
      if (error instanceof AppException)
        await this.admission.recordDenied(principal, input, definitionVersion, error)
      throw error
    }
  }

  async receipt(principal: RequestPrincipal, commandId: string): Promise<WorkReceipt> {
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, false)
      await this.budgets.request(ctx, rows, true)
    })
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      await this.authority.assert(ctx, principal, false)
      const command = await ctx.tx.backgroundCommand.findUnique({
        where: { actorId_commandId: { actorId: principal.sub, commandId } },
        include: { targets: { orderBy: { targetId: 'asc' }, take: 51 } },
      })
      if (!command) throw new NotFoundException('Command receipt')
      return projectWorkReceipt(command, command.targets, ctx.now)
    })
  }

  async reconcile(
    principal: RequestPrincipal,
    commandId: string,
    input: WorkReconciliation,
    barrier: (
      workId: string,
      dispatchUntil: number,
      pgTime: number,
      sampleStartedAt: number
    ) => Promise<void>
  ): Promise<WorkReceipt> {
    const request = workReconciliationSchema.parse(input)
    await this.admission.chargeRequest(principal)
    const startedAt = performance.now()
    const captured = await backgroundControlTransaction(this.prisma, async (ctx) => {
      await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, true)
      const command = await ctx.tx.backgroundCommand.findUnique({
        where: { actorId_commandId: { actorId: principal.sub, commandId } },
        include: { targets: { orderBy: { targetId: 'asc' }, take: 51 } },
      })
      if (!command) throw new NotFoundException('Command receipt')
      if (
        command.revision !== request.revision ||
        request.incarnation !== undefined ||
        command.targets.length < 1 ||
        command.targets.length > CONTROL_LIMITS.batchTargets ||
        command.targets.some((target) => ['prepared', 'dispatching'].includes(target.state)) ||
        !command.targets.some(
          (target) => target.state === 'unknown' && target.resolution === 'none'
        )
      )
        throw backgroundControlError('COMMAND_CONFLICT')
      return {
        workId: command.workId,
        dispatchUntil: Math.max(
          command.dispatchUntil.getTime(),
          ...command.targets.map(
            (target) => target.dispatchUntil?.getTime() ?? command.dispatchUntil.getTime()
          )
        ),
        pgTime: (await sampleControlClock(ctx.tx)).getTime(),
      }
    })
    // No PG lock is held across the new connection's read-only settlement barrier.
    if (captured.pgTime <= captured.dispatchUntil) throw backgroundControlError('COMMAND_CONFLICT')
    await barrier(captured.workId, captured.dispatchUntil, captured.pgTime, startedAt)
    await backgroundControlTransaction(this.prisma, (ctx) =>
      this.settlement.acknowledgeUnknown(ctx, principal, commandId, request)
    )
    return this.receipt(principal, commandId)
  }

  async reconcileEvidence(
    principal: RequestPrincipal,
    workId: string,
    jobId: string,
    input: WorkReconciliation,
    evidence?: ProviderEvidenceStore
  ): Promise<void> {
    const request = workReconciliationSchema.parse(input)
    await this.admission.chargeRequest(principal)
    if (!evidence) throw backgroundControlError('ACTION_UNAVAILABLE')
    try {
      await backgroundControlTransaction(this.prisma, (ctx) =>
        this.settlement.acknowledgeEvidence(ctx, principal, workId, jobId, request, evidence)
      )
    } catch (error) {
      if (error instanceof WorkPolicyError) throw backgroundControlError(error.reason)
      throw error
    }
  }

  private async dispatch(
    principal: RequestPrincipal,
    commandId: string,
    target: BackgroundCommandTarget,
    port: BrokerCommandPort
  ): Promise<void> {
    const dispatched = await backgroundControlTransaction(this.prisma, (ctx) =>
      this.settlement.beginDispatch(ctx, principal, commandId, target.targetId)
    )
    if (!dispatched?.dispatchId) return
    let outcome: CommandOutcome
    try {
      outcome = await port.dispatch(dispatched)
    } catch {
      outcome = { state: 'unknown' }
    }
    const witness = {
      actorId: principal.sub,
      commandId,
      targetId: target.targetId,
      dispatchId: dispatched.dispatchId,
      outcome,
    }
    try {
      await this.finalize(witness)
    } catch {
      // No broker redispatch. If this volatile witness is lost, durable dispatching remains uncertain.
      this.buffer.enqueue('command', `${commandId}:${target.targetId}`, witness)
    }
  }

  private finalize(witness: z.infer<typeof witnessSchema>): Promise<void> {
    return backgroundControlTransaction(this.prisma, (ctx) =>
      this.settlement.finalize(
        ctx,
        witness.actorId,
        witness.commandId,
        witness.targetId,
        witness.dispatchId,
        witness.outcome
      )
    )
  }
}
