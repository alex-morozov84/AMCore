import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { type RequestPrincipal, type WorkCommand, workJobIdSchema } from '@amcore/shared'

import { AuditLogService } from '../audit/audit-log.service'

import { assertNewWorkCommandTime, canonicalWorkCommand } from './background-command-codec'
import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets, type LockedControlBudgets } from './background-control-budgets'
import { backgroundControlError } from './background-control-error'
import { BackgroundControlReservations } from './background-control-reservations'

import { AppException } from '@/common/exceptions'
import {
  AuditActorType,
  AuditCategory,
  AuditTargetType,
  type BackgroundCommand,
  type BackgroundCommandTarget,
} from '@/generated/prisma/client'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'
import {
  backgroundControlTransaction,
  type ControlTransaction,
} from '@/infrastructure/background-work/control-transaction'
import type { ControlSnapshot } from '@/infrastructure/background-work/durable-work'
import { PrismaService } from '@/prisma'

const targetSnapshotSchema = z.strictObject({
  id: workJobIdSchema,
  incarnation: z.uuid().optional(),
  queueEpoch: z.uuidv7().optional(),
  snapshot: z.record(
    z.string().min(1).max(64),
    z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()])
  ),
})
export type CommandTargetSnapshot = ControlSnapshot
export interface PreparedCommand {
  readonly command: BackgroundCommand
  readonly targets: readonly BackgroundCommandTarget[]
  readonly budgets: LockedControlBudgets
  readonly replay: boolean
}
export type CommandAdmissionResult = PreparedCommand | { readonly denied: AppException }

/** Caller owns the short PG transaction; no broker operation or business execution occurs here. */
@Injectable()
export class BackgroundCommandAdmission {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BackgroundControlBudgets,
    private readonly reservations: BackgroundControlReservations,
    private readonly authority: BackgroundControlAuthority,
    private readonly audit: AuditLogService
  ) {}

  /** Commit request cost BEFORE replay lookup/admission; later failure cannot erase that cost. */
  async chargeRequest(principal: RequestPrincipal): Promise<void> {
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      // Current primary credential is required here; freshness is an admission
      // decision after request cost commits, so a step-up denial cannot refund it.
      await this.authority.assert(ctx, principal, false)
      await this.budgets.request(ctx, rows, false)
    })
  }

  /** After committed request cost, a replay needs PG only and never observes or dispatches Redis. */
  async replay(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number
  ): Promise<PreparedCommand | null> {
    const canonical = canonicalWorkCommand(input, definitionVersion)
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, true)
      const existing = await ctx.tx.backgroundCommand.findUnique({
        where: { actorId_commandId: { actorId: principal.sub, commandId: input.commandId } },
        include: {
          targets: { orderBy: { targetId: 'asc' }, take: CONTROL_LIMITS.batchTargets + 1 },
        },
      })
      if (!existing) {
        assertNewWorkCommandTime(input.commandId, ctx.now)
        return null
      }
      if (existing.fingerprint !== canonical.fingerprint)
        throw backgroundControlError('COMMAND_CONFLICT')
      if (existing.targets.length < 1 || existing.targets.length > CONTROL_LIMITS.batchTargets)
        throw backgroundControlError('INCONSISTENT_STATE')
      return { command: existing, targets: existing.targets, budgets: rows, replay: true }
    })
  }

  /** The owning command service calls chargeRequest once before opening this admission transaction. */
  async prepare(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    observed: readonly CommandTargetSnapshot[],
    authority: 'broker' | 'durable' = 'broker'
  ): Promise<PreparedCommand> {
    const canonical = canonicalWorkCommand(input, definitionVersion)
    const command = canonical.command
    const rows = await this.budgets.lock(ctx, principal.sub, command.workId)
    await this.authority.assert(ctx, principal, true)
    return this.prepareIntent(ctx, principal.sub, canonical, observed, rows, authority)
  }

  /** Strict denied audit is separate from the rolled-back intent; it cannot authorize a dispatch. */
  async recordDenied(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    error: AppException
  ): Promise<CommandAdmissionResult> {
    const canonical = canonicalWorkCommand(input, definitionVersion)
    const command = canonical.command
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, false)
      if (!(await this.budgets.denialAudit(ctx, rows.actor, command.workId))) return
      await this.audit.record(
        {
          action: 'background_work.command_denied',
          actorType: AuditActorType.USER,
          actorId: principal.sub,
          category: AuditCategory.SECURITY,
          targetType: AuditTargetType.BACKGROUND_WORK,
          targetId: command.workId,
          metadata: {
            workId: command.workId,
            commandId: command.commandId,
            operation: command.operation,
            outcome: 'rejected',
            reasonCode: error.errorCode,
            snapshotDigest: canonical.fingerprint,
          },
        },
        { tx: ctx.tx }
      )
    })
    return { denied: error }
  }

  async admit(
    principal: RequestPrincipal,
    input: WorkCommand,
    definitionVersion: number,
    observed: readonly CommandTargetSnapshot[]
  ): Promise<CommandAdmissionResult> {
    await this.chargeRequest(principal)
    try {
      return await backgroundControlTransaction(this.prisma, (ctx) =>
        this.prepare(ctx, principal, input, definitionVersion, observed)
      )
    } catch (error) {
      if (!(error instanceof AppException)) throw error
      return this.recordDenied(principal, input, definitionVersion, error)
    }
  }

  private async prepareIntent(
    ctx: ControlTransaction,
    actorId: string,
    canonical: ReturnType<typeof canonicalWorkCommand>,
    observed: readonly CommandTargetSnapshot[],
    rows: LockedControlBudgets,
    authority: 'broker' | 'durable'
  ): Promise<PreparedCommand> {
    const command = canonical.command
    const existing = await ctx.tx.backgroundCommand.findUnique({
      where: { actorId_commandId: { actorId, commandId: command.commandId } },
      include: { targets: { orderBy: { targetId: 'asc' }, take: CONTROL_LIMITS.batchTargets + 1 } },
    })
    if (existing) {
      if (existing.targets.length < 1 || existing.targets.length > CONTROL_LIMITS.batchTargets)
        throw backgroundControlError('INCONSISTENT_STATE')
      if (existing.fingerprint !== canonical.fingerprint)
        throw backgroundControlError('COMMAND_CONFLICT')
      return { command: existing, targets: existing.targets, budgets: rows, replay: true }
    }
    assertNewWorkCommandTime(command.commandId, ctx.now)
    const targets = this.validateTargets(command, observed, authority)
    await this.assertNoPendingCommand(ctx, command.workId, targets)
    await this.budgets.targets(ctx, rows, targets.length, command.operation)
    await this.reservations.reserve(ctx, rows, canonical.bytes, targets.length)
    const snapshots =
      authority === 'broker' && (command.operation === 'pause' || command.operation === 'resume')
        ? [await this.reserveQueueSequence(ctx, command, targets[0]!)]
        : targets
    const created = await ctx.tx.backgroundCommand.create({
      data: {
        actorId,
        commandId: command.commandId,
        workId: command.workId,
        operation: command.operation,
        fingerprint: canonical.fingerprint,
        reason: command.reason,
        logicalBytes: canonical.bytes,
        createdAt: ctx.now,
        dispatchUntil: new Date(ctx.now.getTime() + CONTROL_LIMITS.batchDeadlineMs),
        targets: {
          create: snapshots.map((target) => ({
            targetId: target.id,
            workId: command.workId,
            incarnation: target.incarnation,
            queueEpoch: target.queueEpoch,
            snapshot: target.snapshot,
            logicalBytes: CONTROL_LIMITS.targetBytes,
          })),
        },
      },
      include: { targets: { orderBy: { targetId: 'asc' }, take: CONTROL_LIMITS.batchTargets + 1 } },
    })
    await this.audit.record(
      {
        action: 'background_work.command_intent',
        actorType: AuditActorType.USER,
        actorId,
        category: AuditCategory.SECURITY,
        targetType: AuditTargetType.BACKGROUND_WORK,
        targetId: command.workId,
        metadata: {
          workId: command.workId,
          commandId: command.commandId,
          operation: command.operation,
          reason: command.reason,
          count: targets.length,
          snapshotDigest: canonical.fingerprint,
        },
      },
      { tx: ctx.tx }
    )
    return { command: created, targets: created.targets, budgets: rows, replay: false }
  }

  private async reserveQueueSequence(
    ctx: ControlTransaction,
    command: WorkCommand,
    target: CommandTargetSnapshot
  ): Promise<CommandTargetSnapshot> {
    const observed = target.snapshot.controlRevision
    if (
      !target.queueEpoch ||
      typeof observed !== 'number' ||
      !Number.isSafeInteger(observed) ||
      observed < 0 ||
      typeof target.snapshot.paused !== 'boolean'
    )
      throw backgroundControlError('CONTENT_UNSUPPORTED')
    await ctx.tx.backgroundWorkControl.upsert({
      where: { workId: command.workId },
      create: { workId: command.workId },
      update: {},
    })
    await ctx.tx.$queryRaw`SELECT "workId" FROM core.background_work_control
      WHERE "workId" = ${command.workId} FOR UPDATE`
    const authority = await ctx.tx.backgroundWorkControl.findUniqueOrThrow({
      where: { workId: command.workId },
    })
    const next =
      (authority.desiredSequence > BigInt(observed)
        ? authority.desiredSequence
        : BigInt(observed)) + 1n
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw backgroundControlError('STORAGE_LIMIT')
    await ctx.tx.backgroundWorkControl.update({
      where: { workId: command.workId },
      data: {
        desiredSequence: next,
        desiredPaused: command.operation === 'pause',
        observedEpoch: target.queueEpoch,
      },
    })
    return { ...target, snapshot: { ...target.snapshot, nextRevision: Number(next) } }
  }

  private validateTargets(
    command: WorkCommand,
    observed: readonly CommandTargetSnapshot[],
    authority: 'broker' | 'durable'
  ): readonly CommandTargetSnapshot[] {
    const queueAction = command.operation === 'pause' || command.operation === 'resume'
    if (observed.length !== (queueAction ? 1 : command.targets.length))
      throw backgroundControlError('STATE_CHANGED')
    const parsed = observed.map((target) => {
      const result = targetSnapshotSchema.safeParse(target)
      if (!result.success) throw backgroundControlError('CONTENT_UNSUPPORTED')
      return result.data
    })
    if (new Set(parsed.map((target) => target.id)).size !== parsed.length)
      throw backgroundControlError('INCONSISTENT_STATE')
    for (const target of parsed) {
      if (
        Object.keys(target.snapshot).length > 32 ||
        Buffer.byteLength(JSON.stringify(target), 'utf8') > CONTROL_LIMITS.targetBytes - 512
      )
        throw backgroundControlError('CONTENT_UNSUPPORTED')
      if (
        queueAction
          ? target.id !== command.workId ||
            target.snapshot.revision !== command.expectedWorkRevision
          : !command.targets.some(
              (requested) =>
                requested.id === target.id &&
                requested.incarnation === target.incarnation &&
                (authority === 'durable' || requested.revision === target.snapshot.revision)
            )
      )
        throw backgroundControlError('STATE_CHANGED')
    }
    return parsed
  }

  private async assertNoPendingCommand(
    ctx: ControlTransaction,
    workId: string,
    targets: readonly CommandTargetSnapshot[]
  ): Promise<void> {
    for (const target of targets) {
      const conflict = await ctx.tx.backgroundCommandTarget.findFirst({
        where: {
          workId,
          OR: [
            { targetId: target.id, incarnation: target.incarnation ?? null },
            { targetId: workId, incarnation: null },
          ],
          state: { in: ['prepared', 'dispatching', 'unknown'] },
          resolution: 'none',
        },
        select: { targetId: true },
      })
      if (conflict) throw backgroundControlError('COMMAND_CONFLICT')
    }
  }
}
