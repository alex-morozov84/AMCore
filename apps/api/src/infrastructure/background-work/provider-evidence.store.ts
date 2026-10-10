import { Injectable } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import type { WorkReason, WorkReconciliation } from '@amcore/shared'

import { compactProviderEvidenceBytes } from './compact-provider-evidence'
import { CONTROL_LIMITS } from './control-limits'
import { backgroundControlTransaction, type ControlTransaction } from './control-transaction'
import {
  changeUnresolvedEvidence,
  compactEvidenceAccounting,
  lockEvidenceBudgets,
  removeEvidenceRow,
  reserveEvidenceRow,
} from './provider-evidence-accounting'
import {
  constrainedRetryFloor,
  floorEligible,
  HORIZON_CHECK_OVERHEAD_MS,
  PROVIDER_WINDOW_CLOCK,
  type RetryAfterConstraint,
} from './provider-window-clock'
import { WorkPolicyError } from './work-policy-error'

import type { BackgroundEffectEvidence } from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

const identitySchema = z.strictObject({
  workId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  jobId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  incarnation: z.uuidv7(),
  queueEpoch: z.uuidv7(),
  jobName: z.string().min(1).max(64),
  wireVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  automaticLimit: z.number().int().min(1).max(10),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  providerScope: z.string().regex(/^[a-f0-9]{64}$/),
  manualCommandId: z.uuidv7().optional(),
})
export type ProviderAdmission = z.infer<typeof identitySchema>
const controlIdentitySchema = identitySchema
  .omit({ requestDigest: true, providerScope: true, manualCommandId: true })
  .extend({ evidenceRevision: z.number().int().nonnegative().nullable() })
export type ProviderControlIdentity = z.infer<typeof controlIdentitySchema>
export interface ProviderAttempt {
  readonly row: BackgroundEffectEvidence
  readonly attemptId: string
  readonly pgTime: number
  readonly mode: 'automatic' | 'manual'
}
const previousSchema = z.strictObject({
  previousCertainty: z.enum(['none', 'unknown']),
  previousUnresolved: z.number().int().min(0).max(11),
})
export interface ProviderOutcome {
  readonly certainty: 'none' | 'accepted' | 'unknown'
  readonly code:
    'COMPLETED' | 'RATE_LIMITED' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE' | 'NO_CALL'
  readonly floorUpper?: number
  readonly retryAfter?: RetryAfterConstraint
}
export interface ProviderOutcomeWitness {
  readonly attemptId: string
  readonly incarnation: string
  readonly kind: 'reported' | 'denied-before-call'
  readonly brokerRevision?: number
}

/** Provider-window ONLY: ordinary idempotent handlers never inject or call this safety owner. */
@Injectable()
export class ProviderEvidenceStore {
  constructor(private readonly prisma: PrismaService) {}

  read(workId: string, incarnation: string): Promise<BackgroundEffectEvidence | null> {
    return this.prisma.backgroundEffectEvidence.findUnique({
      where: { workId_incarnation: { workId, incarnation } },
    })
  }

  /** Started legacy requests have no reproducible provider identity; record uncertainty, never a new horizon. */
  async quarantineLegacy(input: ProviderControlIdentity, starts: number): Promise<void> {
    const identity = controlIdentitySchema.parse(input)
    z.number().int().min(1).max(2147483647).parse(starts)
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const budgets = await lockEvidenceBudgets(ctx, identity.workId)
      const existing = await this.lock(ctx, identity.workId, identity.incarnation)
      if (existing) {
        if (
          existing.jobId !== identity.jobId ||
          existing.queueEpoch !== identity.queueEpoch ||
          existing.certainty !== 'unknown'
        )
          throw new WorkPolicyError('OUTCOME_UNRECORDED')
        return
      }
      await reserveEvidenceRow(ctx, budgets)
      await changeUnresolvedEvidence(ctx, budgets, 1)
      const { evidenceRevision: _revision, ...fields } = identity
      const row = await ctx.tx.backgroundEffectEvidence.create({
        data: {
          ...fields,
          logicalBytes: CONTROL_LIMITS.evidence.rowBytes,
          revision: 1,
          certainty: 'unknown',
          unresolvedCount: 1,
          outcomeRecorded: true,
          createdAt: ctx.now,
          safeResult: {
            code: 'LEGACY_REQUEST_UNKNOWN',
            legacyAttemptsStarted: starts,
            retryClockSupported: false,
          },
        },
      })
      this.assertRowSize(row)
    })
  }

  dispositionReason(row: BackgroundEffectEvidence, now: number): WorkReason | undefined {
    // An unrecorded attempt may still re-fence. Never invalidate it while a call could start.
    // Once the immutable horizon is certainly past, disposition still retains its marker/uncertainty.
    if (
      (row.activeAttemptId || !row.outcomeRecorded) &&
      (!row.nominalDeadline ||
        !Number.isSafeInteger(now) ||
        now <= row.nominalDeadline.getTime() + 2 * PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs)
    )
      return 'OUTCOME_UNRECORDED'
    if (row.certainty !== 'unknown' || row.unresolvedCount < 1) return 'ACTION_UNAVAILABLE'
    if (row.disposition !== 'none') return 'ALREADY_IN_STATE'
    if (row.revision >= 2147483647) return 'CONTENT_UNSUPPORTED'
    return undefined
  }

  /** Metadata disposition cannot erase certainty, release evidence capacity or authorize another call. */
  async acknowledge(
    ctx: ControlTransaction,
    workId: string,
    jobId: string,
    input: WorkReconciliation
  ): Promise<BackgroundEffectEvidence> {
    if (!input.incarnation) throw new WorkPolicyError('STATE_CHANGED')
    await lockEvidenceBudgets(ctx, workId)
    const row = await this.lock(ctx, workId, input.incarnation)
    if (!row || row.jobId !== jobId || row.revision !== input.revision)
      throw new WorkPolicyError('STATE_CHANGED')
    const reason = this.dispositionReason(row, ctx.now.getTime())
    if (reason) throw new WorkPolicyError(reason)
    this.assertRowSize({
      ...row,
      revision: row.revision + 1,
      disposition: 'acknowledged_unknown',
      updatedAt: ctx.now,
    })
    return ctx.tx.backgroundEffectEvidence.update({
      where: {
        workId_incarnation: {
          workId,
          incarnation: input.incarnation,
        },
      },
      data: { revision: { increment: 1 }, disposition: 'acknowledged_unknown' },
    })
  }

  observe(
    workId: string,
    incarnation: string
  ): Promise<{ row: BackgroundEffectEvidence | null; now: number }> {
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      await lockEvidenceBudgets(ctx, workId)
      return { row: await this.lock(ctx, workId, incarnation), now: ctx.now.getTime() }
    })
  }

  controlReason(
    row: BackgroundEffectEvidence | null,
    operation: 'retry' | 'cancel' | 'cleanup',
    now: number
  ): import('@amcore/shared').WorkReason | undefined {
    if (!row) return operation === 'retry' ? 'REQUEST_EXPIRED' : undefined
    if (row.commandFence) return 'COMMAND_CONFLICT'
    if (!row.outcomeRecorded || row.activeAttemptId) return 'OUTCOME_UNRECORDED'
    if (row.certainty === 'unknown' || row.unresolvedCount !== 0) return 'EFFECT_UNKNOWN'
    if (operation === 'cancel')
      return row.firstDispatchAt ||
        row.autoStartsUsed !== 0 ||
        row.manualGrant !== 'none' ||
        row.certainty !== 'none'
        ? 'ACTIVE_JOB'
        : undefined
    if (operation !== 'retry') return undefined
    if (row.certainty !== 'none') return 'EFFECT_ACCEPTED'
    if (row.manualGrant !== 'none') return 'MANUAL_GRANT_SPENT'
    if (
      !z
        .object({
          code: z.enum(['TRANSIENT_FAILURE', 'RATE_LIMITED']),
          retryClockSupported: z.literal(true),
        })
        .safeParse(row.safeResult).success
    )
      return 'PERMANENT_FAILURE'
    if (!row.requestDigest || !row.providerScope || !row.nominalDeadline) return 'REQUEST_EXPIRED'
    try {
      this.assertTime(row, now)
    } catch (error) {
      if (error instanceof WorkPolicyError) return error.reason
      throw error
    }
  }

  async reserve(input: ProviderAdmission): Promise<ProviderAttempt | { readonly accepted: true }> {
    const request = identitySchema.parse(input)
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      const budgets = await lockEvidenceBudgets(ctx, request.workId)
      let row = await this.lock(ctx, request.workId, request.incarnation)
      if (!row) {
        await reserveEvidenceRow(ctx, budgets)
        row = await ctx.tx.backgroundEffectEvidence.create({
          data: {
            workId: request.workId,
            incarnation: request.incarnation,
            queueEpoch: request.queueEpoch,
            jobId: request.jobId,
            jobName: request.jobName,
            wireVersion: request.wireVersion,
            policyVersion: request.policyVersion,
            automaticLimit: request.automaticLimit,
            requestDigest: request.requestDigest,
            providerScope: request.providerScope,
            logicalBytes: CONTROL_LIMITS.evidence.rowBytes,
            createdAt: ctx.now,
          },
        })
      }
      if (row.certainty !== 'accepted' && row.commandFence && row.manualGrant !== 'reserved')
        throw new WorkPolicyError('COMMAND_CONFLICT')
      if (this.canPrepare(row))
        row = await ctx.tx.backgroundEffectEvidence.update({
          where: { workId_incarnation: { workId: row.workId, incarnation: row.incarnation } },
          data: { requestDigest: request.requestDigest, providerScope: request.providerScope },
        })
      this.assertIdentity(row, request)
      if (row.certainty === 'accepted') return { accepted: true }
      if (!row.outcomeRecorded || row.activeAttemptId)
        throw new WorkPolicyError('OUTCOME_UNRECORDED')
      if (
        row.safeResult &&
        typeof row.safeResult === 'object' &&
        !Array.isArray(row.safeResult) &&
        row.safeResult.retryClockSupported === false
      )
        throw new WorkPolicyError('CLOCK_UNCERTAIN')
      this.assertTime(row, ctx.now.getTime())
      const mode = await this.mode(ctx, row, request.manualCommandId)
      if (row.unresolvedCount === 0) await changeUnresolvedEvidence(ctx, budgets, 1)
      const previous = previousSchema.parse({
        previousCertainty: row.certainty,
        previousUnresolved: row.unresolvedCount,
      })
      const attemptId = uuidv7()
      const firstDispatchAt = row.firstDispatchAt ?? ctx.now
      const updated = await ctx.tx.backgroundEffectEvidence.update({
        where: { workId_incarnation: { workId: row.workId, incarnation: row.incarnation } },
        data: {
          revision: { increment: 1 },
          activeAttemptId: attemptId,
          outcomeRecorded: false,
          certainty: 'unknown',
          unresolvedCount: { increment: 1 },
          safeResult: previous,
          firstDispatchAt,
          nominalDeadline:
            row.nominalDeadline ??
            new Date(firstDispatchAt.getTime() + PROVIDER_WINDOW_CLOCK.providerDedupHorizonMs),
          ...(mode === 'manual' ? { manualGrant: 'spent' } : { autoStartsUsed: { increment: 1 } }),
          finalizedAt: null,
        },
      })
      this.assertRowSize(updated)
      return { row: updated, attemptId, pgTime: ctx.now.getTime(), mode }
    })
  }

  /** A no-effect control stub may freeze its FIRST request only after its fence was definitively released. */
  canPrepare(row: BackgroundEffectEvidence): boolean {
    return (
      row.requestDigest === null &&
      row.providerScope === null &&
      row.autoStartsUsed === 0 &&
      row.firstDispatchAt === null &&
      row.nominalDeadline === null &&
      row.certainty === 'none' &&
      row.unresolvedCount === 0 &&
      row.outcomeRecorded &&
      !row.activeAttemptId &&
      !row.commandFence &&
      row.manualGrant === 'none'
    )
  }

  /** Common ADMIN already checked authority; reserve the same identity used by possible-effect admission. */
  async reserveControl(
    ctx: ControlTransaction,
    input: ProviderControlIdentity,
    operation: 'retry' | 'cancel' | 'cleanup',
    commandId: string
  ): Promise<BackgroundEffectEvidence> {
    const identity = controlIdentitySchema.parse(input)
    const fence = z.uuidv7().parse(commandId)
    const budgets = await lockEvidenceBudgets(ctx, identity.workId)
    let row = await this.lock(ctx, identity.workId, identity.incarnation)
    if ((row?.revision ?? null) !== identity.evidenceRevision)
      throw new WorkPolicyError('STATE_CHANGED')
    if (!row) {
      if (operation === 'retry') throw new WorkPolicyError('REQUEST_EXPIRED')
      await reserveEvidenceRow(ctx, budgets)
      row = await ctx.tx.backgroundEffectEvidence.create({
        data: {
          workId: identity.workId,
          incarnation: identity.incarnation,
          jobId: identity.jobId,
          queueEpoch: identity.queueEpoch,
          jobName: identity.jobName,
          wireVersion: identity.wireVersion,
          policyVersion: identity.policyVersion,
          automaticLimit: identity.automaticLimit,
          logicalBytes: CONTROL_LIMITS.evidence.rowBytes,
          createdAt: ctx.now,
        },
      })
    }
    if (
      row.queueEpoch !== identity.queueEpoch ||
      row.jobId !== identity.jobId ||
      row.jobName !== identity.jobName ||
      row.wireVersion !== identity.wireVersion ||
      row.policyVersion !== identity.policyVersion ||
      row.automaticLimit !== identity.automaticLimit ||
      row.clockPolicyVersion !== PROVIDER_WINDOW_CLOCK.version ||
      row.revision >= 2147483647
    )
      throw new WorkPolicyError('VERSION_UNSUPPORTED')
    const reason = this.controlReason(row, operation, ctx.now.getTime())
    if (reason) throw new WorkPolicyError(reason)
    this.assertRowSize({
      ...row,
      revision: row.revision + 1,
      commandFence: fence,
      ...(operation === 'retry' ? { manualGrant: 'reserved' } : {}),
    })
    const updated = await ctx.tx.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId: row.workId, incarnation: row.incarnation } },
      data: {
        revision: { increment: 1 },
        commandFence: fence,
        ...(operation === 'retry' ? { manualGrant: 'reserved' } : {}),
      },
    })
    return updated
  }

  /** Settlement releases only its own fence; acknowledged retry keeps its irrevocable reserved grant. */
  async settleControl(
    ctx: ControlTransaction,
    workId: string,
    incarnation: string,
    commandId: string,
    revision: number,
    operation: string,
    outcome: 'applied' | 'rejected' | 'not_attempted' | 'unknown' | 'acknowledged_unknown'
  ): Promise<void> {
    if (outcome === 'unknown') return
    await lockEvidenceBudgets(ctx, workId)
    const row = await this.lock(ctx, workId, incarnation)
    if (
      !row ||
      row.commandFence !== commandId ||
      row.revision !== revision ||
      row.activeAttemptId ||
      !row.outcomeRecorded
    )
      throw new WorkPolicyError('COMMAND_CONFLICT')
    // Applied retry remains fenced until the worker observes its committed ADMIN receipt.
    if (operation === 'retry' && (outcome === 'applied' || outcome === 'acknowledged_unknown'))
      return
    await ctx.tx.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId, incarnation } },
      data: {
        revision: { increment: 1 },
        commandFence: null,
        ...(operation === 'retry' ? { manualGrant: 'none' } : {}),
        ...(row.certainty === 'none' ? { finalizedAt: ctx.now } : {}),
      },
    })
  }

  /** Refresh the same reservation; never moves P0/deadline/floor or spends another start/grant. */
  async refence(attempt: ProviderAttempt): Promise<ProviderAttempt> {
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      await lockEvidenceBudgets(ctx, attempt.row.workId)
      const row = await this.lock(ctx, attempt.row.workId, attempt.row.incarnation)
      this.assertAttempt(row, attempt)
      this.assertTime(row!, ctx.now.getTime())
      return { ...attempt, row: row!, pgTime: ctx.now.getTime() }
    })
  }

  /** Requires a lock/incarnation/attempt-fenced broker result witness; no effect is repeated here. */
  async finalize(
    attempt: ProviderAttempt,
    outcome: ProviderOutcome,
    witness: ProviderOutcomeWitness
  ): Promise<void> {
    if (
      witness.attemptId !== attempt.attemptId ||
      witness.incarnation !== attempt.row.incarnation ||
      (witness.kind === 'denied-before-call'
        ? outcome.certainty !== 'none' || outcome.code !== 'NO_CALL'
        : !Number.isSafeInteger(witness.brokerRevision) || witness.brokerRevision! < 1)
    )
      throw new WorkPolicyError('OUTCOME_UNRECORDED')
    await backgroundControlTransaction(this.prisma, async (ctx) => {
      const budgets = await lockEvidenceBudgets(ctx, attempt.row.workId)
      const row = await this.lock(ctx, attempt.row.workId, attempt.row.incarnation)
      if (
        row?.outcomeRecorded &&
        row.safeResult &&
        typeof row.safeResult === 'object' &&
        !Array.isArray(row.safeResult) &&
        row.safeResult.lastAttemptId === attempt.attemptId
      )
        return
      this.assertAttempt(row, attempt)
      const previous = previousSchema.parse(row!.safeResult)
      const unresolved =
        outcome.certainty === 'accepted'
          ? 0
          : outcome.certainty === 'none'
            ? previous.previousUnresolved
            : previous.previousUnresolved + 1
      const certainty =
        outcome.certainty === 'accepted' ? 'accepted' : unresolved > 0 ? 'unknown' : 'none'
      if (unresolved === 0) await changeUnresolvedEvidence(ctx, budgets, -1)
      const retryClockSupported = outcome.retryAfter?.kind !== 'unsupported'
      const floor =
        outcome.retryAfter && outcome.retryAfter.kind !== 'unsupported'
          ? constrainedRetryFloor(Number(row!.floorUpper), ctx.now.getTime(), outcome.retryAfter)
          : (outcome.floorUpper ?? 0)
      if (!Number.isSafeInteger(floor) || floor < 0) throw new WorkPolicyError('CLOCK_UNCERTAIN')
      const updated = await ctx.tx.backgroundEffectEvidence.update({
        where: { workId_incarnation: { workId: row!.workId, incarnation: row!.incarnation } },
        data: {
          revision: { increment: 1 },
          certainty,
          unresolvedCount: unresolved,
          activeAttemptId: null,
          outcomeRecorded: true,
          floorUpper: row!.floorUpper > BigInt(floor) ? row!.floorUpper : BigInt(floor),
          ...(row!.manualGrant === 'spent' ? { commandFence: null } : {}),
          safeResult: {
            code: outcome.code,
            certainty,
            lastAttemptId: attempt.attemptId,
            retryClockSupported,
          },
          finalizedAt: certainty === 'unknown' ? null : ctx.now,
        },
      })
      this.assertRowSize(updated)
    })
  }

  /** PG-owned evidence outlives stock broker hashes; only definitive unfenced rows can expire. */
  async purge(ctx: ControlTransaction, workId: string, incarnation: string): Promise<boolean> {
    const budgets = await lockEvidenceBudgets(ctx, workId)
    const row = await this.lock(ctx, workId, incarnation)
    if (
      !row ||
      !row.finalizedAt ||
      row.finalizedAt.getTime() > ctx.now.getTime() - CONTROL_LIMITS.retentionMs ||
      !['none', 'accepted'].includes(row.certainty) ||
      row.unresolvedCount !== 0 ||
      !row.outcomeRecorded ||
      row.activeAttemptId ||
      row.commandFence ||
      row.disposition !== 'none'
    )
      return false
    await removeEvidenceRow(ctx, budgets, row.logicalBytes)
    await ctx.tx.backgroundEffectEvidence.delete({
      where: { workId_incarnation: { workId, incarnation } },
    })
    return true
  }

  /** Old uncertainty is never deleted. All effect identity, clocks, fences and quotas except bytes survive. */
  async compactUnknown(
    ctx: ControlTransaction,
    workId: string,
    incarnation: string
  ): Promise<boolean> {
    const budgets = await lockEvidenceBudgets(ctx, workId)
    const row = await this.lock(ctx, workId, incarnation)
    if (
      !row ||
      row.certainty !== 'unknown' ||
      row.unresolvedCount < 1 ||
      row.createdAt.getTime() > ctx.now.getTime() - CONTROL_LIMITS.retentionMs ||
      row.logicalBytes <= CONTROL_LIMITS.compactUnknownBytes
    )
      return false
    compactProviderEvidenceBytes(row) // Before accounting/write; no safety field or result is discarded.
    await compactEvidenceAccounting(
      ctx,
      budgets,
      row.logicalBytes,
      CONTROL_LIMITS.compactUnknownBytes
    )
    await ctx.tx.backgroundEffectEvidence.update({
      where: { workId_incarnation: { workId, incarnation } },
      data: { logicalBytes: CONTROL_LIMITS.compactUnknownBytes },
    })
    return true
  }

  private async lock(
    ctx: ControlTransaction,
    workId: string,
    incarnation: string
  ): Promise<BackgroundEffectEvidence | null> {
    await ctx.tx.$queryRaw`SELECT "incarnation" FROM core.background_effect_evidence
      WHERE "workId" = ${workId} AND incarnation = ${incarnation}::uuid FOR UPDATE`
    return ctx.tx.backgroundEffectEvidence.findUnique({
      where: { workId_incarnation: { workId, incarnation } },
    })
  }

  private assertIdentity(row: BackgroundEffectEvidence, input: ProviderAdmission): void {
    if (row.providerScope !== input.providerScope) throw new WorkPolicyError('PROVIDER_CHANGED')
    if (row.requestDigest !== input.requestDigest) throw new WorkPolicyError('REQUEST_EXPIRED')
    if (
      row.queueEpoch !== input.queueEpoch ||
      row.jobId !== input.jobId ||
      row.jobName !== input.jobName ||
      row.wireVersion !== input.wireVersion ||
      row.policyVersion !== input.policyVersion ||
      row.automaticLimit !== input.automaticLimit ||
      row.clockPolicyVersion !== PROVIDER_WINDOW_CLOCK.version
    )
      throw new WorkPolicyError('VERSION_UNSUPPORTED')
    if (
      row.revision >= 2147483647 ||
      row.unresolvedCount < 0 ||
      row.unresolvedCount > 10 ||
      row.autoStartsUsed < 0 ||
      row.autoStartsUsed > row.automaticLimit ||
      !['none', 'reserved', 'spent'].includes(row.manualGrant) ||
      !['none', 'unknown', 'accepted'].includes(row.certainty) ||
      !!row.firstDispatchAt !== !!row.nominalDeadline ||
      (row.firstDispatchAt &&
        row.nominalDeadline!.getTime() !==
          row.firstDispatchAt.getTime() + PROVIDER_WINDOW_CLOCK.providerDedupHorizonMs) ||
      (row.certainty === 'accepted' &&
        (!row.outcomeRecorded || row.activeAttemptId || row.unresolvedCount !== 0))
    )
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  }

  private assertAttempt(row: BackgroundEffectEvidence | null, attempt: ProviderAttempt): void {
    if (
      !row ||
      row.activeAttemptId !== attempt.attemptId ||
      row.revision !== attempt.row.revision ||
      row.outcomeRecorded
    )
      throw new WorkPolicyError('OUTCOME_UNRECORDED')
  }

  private assertTime(row: BackgroundEffectEvidence, now: number): void {
    if (
      row.nominalDeadline &&
      Math.max(now, Number(row.floorUpper) + PROVIDER_WINDOW_CLOCK.timestampErrorBoundMs) +
        HORIZON_CHECK_OVERHEAD_MS >=
        row.nominalDeadline.getTime()
    )
      throw new WorkPolicyError('HORIZON_EXPIRED')
    if (!floorEligible(now, Number(row.floorUpper))) throw new WorkPolicyError('COOLDOWN')
  }

  private async mode(
    ctx: ControlTransaction,
    row: BackgroundEffectEvidence,
    commandId?: string
  ): Promise<'automatic' | 'manual'> {
    if (row.manualGrant === 'spent') throw new WorkPolicyError('MANUAL_GRANT_SPENT')
    if (row.manualGrant === 'reserved') {
      if (row.certainty !== 'none' || row.unresolvedCount !== 0)
        throw new WorkPolicyError('EFFECT_UNKNOWN')
      if (!commandId || row.commandFence !== commandId)
        throw new WorkPolicyError('COMMAND_CONFLICT')
      const command = await ctx.tx.backgroundCommandTarget.findFirst({
        where: {
          workId: row.workId,
          incarnation: row.incarnation,
          targetId: row.jobId,
          commandId,
        },
        select: { state: true, resolution: true },
      })
      if (
        !command ||
        (command.state !== 'applied' && command.resolution !== 'acknowledged_unknown')
      )
        throw new WorkPolicyError('COMMAND_CONFLICT')
      return 'manual'
    }
    if (row.commandFence) throw new WorkPolicyError('COMMAND_CONFLICT')
    if (row.autoStartsUsed >= row.automaticLimit)
      throw new WorkPolicyError('AUTOMATIC_BUDGET_SPENT')
    return 'automatic'
  }

  private assertRowSize(row: BackgroundEffectEvidence): void {
    if (row.logicalBytes <= CONTROL_LIMITS.compactUnknownBytes) {
      compactProviderEvidenceBytes(row)
      return
    }
    if (
      Buffer.byteLength(
        JSON.stringify(row, (_, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value
        ),
        'utf8'
      ) > CONTROL_LIMITS.evidence.rowBytes
    )
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  }
}
