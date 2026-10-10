import { createHash } from 'node:crypto'

import { Injectable, Optional } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'

import type { RequestPrincipal, WorkReason, WorkReconciliation } from '@amcore/shared'

import { AuditLogService } from '../audit/audit-log.service'

import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets, type LockedControlBudgets } from './background-control-budgets'
import { backgroundControlError } from './background-control-error'
import { BackgroundControlReservations } from './background-control-reservations'

import {
  AuditActorType,
  AuditCategory,
  AuditTargetType,
  type BackgroundCommand,
  type BackgroundCommandTarget,
} from '@/generated/prisma/client'
import { CONTROL_LIMITS } from '@/infrastructure/background-work/control-limits'
import type { ControlTransaction } from '@/infrastructure/background-work/control-transaction'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'

export type CommandOutcome =
  | { readonly state: 'applied' }
  | { readonly state: 'rejected' | 'not_attempted'; readonly reason: WorkReason }
  | { readonly state: 'unknown' }

interface LockedCommand {
  readonly command: BackgroundCommand & { targets: BackgroundCommandTarget[] }
  readonly budgets: LockedControlBudgets
}

/** Dispatch CAS is committed by the caller BEFORE its single broker EVAL. Finalize never dispatches. */
@Injectable()
export class BackgroundCommandSettlement {
  constructor(
    private readonly budgets: BackgroundControlBudgets,
    private readonly reservations: BackgroundControlReservations,
    private readonly authority: BackgroundControlAuthority,
    private readonly audit: AuditLogService,
    @Optional() private readonly evidence?: ProviderEvidenceStore
  ) {}

  async beginDispatch(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    commandId: string,
    targetId: string
  ): Promise<BackgroundCommandTarget | null> {
    const locked = await this.lock(ctx, principal.sub, commandId)
    await this.authority.assert(ctx, principal, true)
    const target = this.target(locked, targetId)
    if (target.state !== 'prepared') return null
    if (locked.command.dispatchUntil.getTime() <= ctx.now.getTime()) {
      await this.record(ctx, locked, target, { state: 'not_attempted', reason: 'COMMAND_EXPIRED' })
      return null
    }
    const dispatchUntil = new Date(
      Math.min(
        locked.command.dispatchUntil.getTime(),
        ctx.now.getTime() + CONTROL_LIMITS.redisDeadlineMs
      )
    )
    const updated = await ctx.tx.backgroundCommandTarget.update({
      where: { actorId_commandId_targetId: { actorId: principal.sub, commandId, targetId } },
      data: { state: 'dispatching', dispatchId: uuidv7(), dispatchAfter: ctx.now, dispatchUntil },
    })
    await ctx.tx.backgroundCommand.update({
      where: { actorId_commandId: { actorId: principal.sub, commandId } },
      data: { revision: { increment: 1 } },
    })
    await this.auditOutcome(ctx, locked.command, updated)
    return updated
  }

  async finalize(
    ctx: ControlTransaction,
    actorId: string,
    commandId: string,
    targetId: string,
    dispatchId: string,
    outcome: CommandOutcome
  ): Promise<void> {
    const locked = await this.lock(ctx, actorId, commandId)
    const target = this.target(locked, targetId)
    if (target.dispatchId !== dispatchId) throw backgroundControlError('COMMAND_CONFLICT')
    if (target.resolution !== 'none' || !['dispatching', 'unknown'].includes(target.state)) return
    if (target.state === 'unknown' && outcome.state === 'unknown') return
    await this.record(ctx, locked, target, outcome)
  }

  /** PG-only bookkeeping: expiration never authorizes or repeats a business/broker effect. */
  async expire(
    ctx: ControlTransaction,
    actorId: string,
    commandId: string,
    targetId: string
  ): Promise<void> {
    const locked = await this.lock(ctx, actorId, commandId)
    const target = this.target(locked, targetId)
    if (target.resolution !== 'none') return
    if (target.state === 'prepared' && locked.command.dispatchUntil.getTime() <= ctx.now.getTime())
      await this.record(ctx, locked, target, { state: 'not_attempted', reason: 'COMMAND_EXPIRED' })
    else if (
      target.state === 'dispatching' &&
      target.dispatchUntil &&
      target.dispatchUntil.getTime() <= ctx.now.getTime()
    )
      await this.record(ctx, locked, target, { state: 'unknown' })
  }

  /** Never remove an unknown tombstone, including operator-acknowledged uncertainty. */
  async purgeReceipt(
    ctx: ControlTransaction,
    actorId: string,
    commandId: string,
    remainingTargets: number
  ): Promise<number> {
    const locked = await this.lock(ctx, actorId, commandId)
    const cutoff = ctx.now.getTime() - CONTROL_LIMITS.retentionMs
    if (
      !locked.command.finalizedAt ||
      locked.command.finalizedAt.getTime() > cutoff ||
      locked.command.targets.length > remainingTargets ||
      locked.command.targets.some(
        (target) =>
          !['applied', 'rejected', 'not_attempted'].includes(target.state) ||
          !target.finalizedAt ||
          target.finalizedAt.getTime() > cutoff
      )
    )
      return 0
    const targets = locked.command.targets
    await this.reservations.removeReceipt(
      ctx,
      locked.budgets,
      locked.command.logicalBytes,
      targets.length,
      targets.reduce((sum, target) => sum + target.logicalBytes, 0)
    )
    await ctx.tx.backgroundCommandTarget.deleteMany({ where: { actorId, commandId } })
    await ctx.tx.backgroundCommand.delete({ where: { actorId_commandId: { actorId, commandId } } })
    return targets.length
  }

  /** Retain protected unknown identities/digests; trim only old free reason and safe snapshot detail. */
  async compactUnknownReceipt(
    ctx: ControlTransaction,
    actorId: string,
    commandId: string,
    remainingTargets: number
  ): Promise<number> {
    const locked = await this.lock(ctx, actorId, commandId)
    if (
      locked.command.createdAt.getTime() > ctx.now.getTime() - CONTROL_LIMITS.retentionMs ||
      locked.command.targets.some((target) => ['prepared', 'dispatching'].includes(target.state))
    )
      return 0
    const targets = locked.command.targets.filter(
      (target) =>
        target.state === 'unknown' && target.logicalBytes > CONTROL_LIMITS.compactUnknownBytes
    )
    if (!targets.length || targets.length > remainingTargets) return 0
    const snapshots = targets.map((target) => {
      for (const [value, limit] of [
        [target.actorId, 64],
        [target.workId, 64],
        [target.targetId, 128],
      ] as const)
        if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.byteLength(value) > limit)
          throw backgroundControlError('CONTENT_UNSUPPORTED')
      if (
        target.reason !== null &&
        (!/^[A-Z0-9_]+$/.test(target.reason) || Buffer.byteLength(target.reason) > 64)
      )
        throw backgroundControlError('CONTENT_UNSUPPORTED')
      const source = target.snapshot as Record<string, unknown>
      const encoded = JSON.stringify(source)
      if (
        Buffer.byteLength(encoded) > CONTROL_LIMITS.targetBytes ||
        (source.providerRevision !== undefined &&
          (!Number.isSafeInteger(source.providerRevision) ||
            (source.providerRevision as number) < 1))
      )
        throw backgroundControlError('CONTENT_UNSUPPORTED')
      return {
        snapshotDigest: createHash('sha256').update(encoded).digest('hex'),
        ...(source.providerRevision !== undefined
          ? { providerRevision: source.providerRevision as number }
          : {}),
      }
    })
    // Fixed-column representation: bounded IDs256, four UUIDs64, digest32,
    // four timestamps32, safe reason64, flags/lengths/revisions24 =472 bytes.
    // Parent owns operation/fingerprint; existing columns retain identity and uncertainty.
    const reasonBytes = Buffer.byteLength(JSON.stringify(locked.command.reason)) - 2
    if (locked.command.logicalBytes <= reasonBytes)
      throw backgroundControlError('INCONSISTENT_STATE')
    await this.reservations.compactBytes(
      ctx,
      locked.budgets,
      reasonBytes +
        targets.reduce(
          (sum, target) => sum + target.logicalBytes - CONTROL_LIMITS.compactUnknownBytes,
          0
        )
    )
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!
      await ctx.tx.backgroundCommandTarget.update({
        where: {
          actorId_commandId_targetId: {
            actorId,
            commandId,
            targetId: target.targetId,
          },
        },
        data: { snapshot: snapshots[index], logicalBytes: CONTROL_LIMITS.compactUnknownBytes },
      })
    }
    await ctx.tx.backgroundCommand.update({
      where: { actorId_commandId: { actorId, commandId } },
      data: { reason: '', logicalBytes: { decrement: reasonBytes }, revision: { increment: 1 } },
    })
    return targets.length
  }

  /** Caller obtains the ordinary broker settlement barrier before entering this short PG transaction. */
  async acknowledgeUnknown(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    commandId: string,
    input: WorkReconciliation
  ): Promise<void> {
    const locked = await this.lock(ctx, principal.sub, commandId)
    await this.authority.assert(ctx, principal, true)
    if (locked.command.revision !== input.revision || input.incarnation !== undefined)
      throw backgroundControlError('COMMAND_CONFLICT')
    const targets = locked.command.targets.filter(
      (target) => target.state === 'unknown' && target.resolution === 'none'
    )
    if (
      !targets.length ||
      locked.command.targets.some((target) => ['prepared', 'dispatching'].includes(target.state))
    )
      throw backgroundControlError('COMMAND_CONFLICT')
    for (const target of targets) {
      const snapshot = target.snapshot as Record<string, unknown>
      if (snapshot.providerRevision !== undefined) {
        if (
          !this.evidence ||
          !target.incarnation ||
          typeof snapshot.providerRevision !== 'number' ||
          !Number.isSafeInteger(snapshot.providerRevision) ||
          snapshot.providerRevision < 1
        )
          throw backgroundControlError('INCONSISTENT_STATE')
        await this.evidence.settleControl(
          ctx,
          locked.command.workId,
          target.incarnation,
          commandId,
          snapshot.providerRevision,
          locked.command.operation,
          'acknowledged_unknown'
        )
      }
      await this.reservations.releaseUnknownExecution(ctx, locked.budgets)
      await ctx.tx.backgroundCommandTarget.update({
        where: {
          actorId_commandId_targetId: {
            actorId: target.actorId,
            commandId,
            targetId: target.targetId,
          },
        },
        data: { resolution: 'acknowledged_unknown', finalizedAt: ctx.now },
      })
      await this.audit.record(
        {
          action: 'background_work.command_resolution',
          actorType: AuditActorType.USER,
          actorId: principal.sub,
          category: AuditCategory.SECURITY,
          targetType: AuditTargetType.BACKGROUND_WORK,
          targetId: locked.command.workId,
          metadata: {
            workId: locked.command.workId,
            commandId,
            dispatchId: target.dispatchId,
            jobId: target.targetId,
            incarnation: target.incarnation,
            operation: locked.command.operation,
            outcome: 'unknown',
            resolution: 'acknowledged_unknown',
            reason: input.reason,
            references: input.references,
          },
        },
        { tx: ctx.tx }
      )
    }
    await this.reservations.releaseCommand(ctx, locked.budgets)
    await ctx.tx.backgroundCommand.update({
      where: { actorId_commandId: { actorId: principal.sub, commandId } },
      data: { revision: { increment: 1 }, finalizedAt: ctx.now },
    })
  }

  async acknowledgeEvidence(
    ctx: ControlTransaction,
    principal: RequestPrincipal,
    workId: string,
    jobId: string,
    input: WorkReconciliation,
    evidence: ProviderEvidenceStore
  ): Promise<void> {
    await this.budgets.lock(ctx, principal.sub, workId)
    await this.authority.assert(ctx, principal, true)
    const row = await evidence.acknowledge(ctx, workId, jobId, input)
    await this.audit.record(
      {
        action: 'background_work.evidence_resolution',
        actorType: AuditActorType.USER,
        actorId: principal.sub,
        category: AuditCategory.SECURITY,
        targetType: AuditTargetType.BACKGROUND_WORK,
        targetId: workId,
        metadata: {
          workId,
          jobId,
          incarnation: row.incarnation,
          queueEpoch: row.queueEpoch,
          resolution: 'acknowledged_unknown',
          outcome: 'unknown',
          reason: input.reason,
          references: input.references,
        },
      },
      { tx: ctx.tx }
    )
  }

  private async lock(
    ctx: ControlTransaction,
    actorId: string,
    commandId: string
  ): Promise<LockedCommand> {
    const identity = await ctx.tx.backgroundCommand.findUniqueOrThrow({
      where: { actorId_commandId: { actorId, commandId } },
      select: { workId: true },
    })
    const budgets = await this.budgets.lock(ctx, actorId, identity.workId)
    await ctx.tx.$queryRaw`SELECT "commandId" FROM core.background_commands
      WHERE "actorId" = ${actorId} AND "commandId" = ${commandId}::uuid FOR UPDATE`
    const command = await ctx.tx.backgroundCommand.findUniqueOrThrow({
      where: { actorId_commandId: { actorId, commandId } },
      include: { targets: { orderBy: { targetId: 'asc' }, take: CONTROL_LIMITS.batchTargets + 1 } },
    })
    if (command.targets.length < 1 || command.targets.length > CONTROL_LIMITS.batchTargets)
      throw backgroundControlError('INCONSISTENT_STATE')
    return { command, budgets }
  }

  private target(locked: LockedCommand, targetId: string): BackgroundCommandTarget {
    const target = locked.command.targets.find((row) => row.targetId === targetId)
    if (!target) throw backgroundControlError('COMMAND_CONFLICT')
    return target
  }

  private async record(
    ctx: ControlTransaction,
    locked: LockedCommand,
    target: BackgroundCommandTarget,
    outcome: CommandOutcome
  ): Promise<void> {
    const definitive = outcome.state !== 'unknown'
    const snapshot = target.snapshot as Record<string, unknown>
    if (snapshot.providerRevision !== undefined) {
      if (
        !this.evidence ||
        !target.incarnation ||
        typeof snapshot.providerRevision !== 'number' ||
        !Number.isSafeInteger(snapshot.providerRevision) ||
        snapshot.providerRevision < 1
      )
        throw backgroundControlError('INCONSISTENT_STATE')
      await this.evidence.settleControl(
        ctx,
        locked.command.workId,
        target.incarnation,
        target.commandId,
        snapshot.providerRevision,
        locked.command.operation,
        outcome.state
      )
    }
    const updated = await ctx.tx.backgroundCommandTarget.update({
      where: {
        actorId_commandId_targetId: {
          actorId: target.actorId,
          commandId: target.commandId,
          targetId: target.targetId,
        },
      },
      data: {
        state: outcome.state,
        reason: 'reason' in outcome ? outcome.reason : null,
        finalizedAt: definitive ? ctx.now : null,
      },
    })
    if (definitive) await this.reservations.releaseTarget(ctx, locked.budgets)
    const allSettled =
      definitive &&
      locked.command.targets.every(
        (row) =>
          row.targetId === target.targetId ||
          ['applied', 'rejected', 'not_attempted'].includes(row.state) ||
          row.resolution !== 'none'
      )
    if (allSettled) await this.reservations.releaseCommand(ctx, locked.budgets)
    await ctx.tx.backgroundCommand.update({
      where: { actorId_commandId: { actorId: target.actorId, commandId: target.commandId } },
      data: { revision: { increment: 1 }, ...(allSettled ? { finalizedAt: ctx.now } : {}) },
    })
    Object.assign(target, updated)
    await this.auditOutcome(ctx, locked.command, updated)
  }

  private async auditOutcome(
    ctx: ControlTransaction,
    command: BackgroundCommand,
    target: BackgroundCommandTarget
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'background_work.command_outcome',
        actorType: AuditActorType.USER,
        actorId: command.actorId,
        category: AuditCategory.SECURITY,
        targetType: AuditTargetType.BACKGROUND_WORK,
        targetId: command.workId,
        metadata: {
          workId: command.workId,
          commandId: command.commandId,
          dispatchId: target.dispatchId,
          jobId: target.targetId,
          incarnation: target.incarnation,
          queueEpoch: target.queueEpoch,
          operation: command.operation,
          outcome: target.state,
          reason: command.reason || undefined,
          reasonCode: target.reason,
        },
      },
      { tx: ctx.tx }
    )
  }
}
