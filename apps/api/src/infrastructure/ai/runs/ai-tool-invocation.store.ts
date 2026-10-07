import type { AiTool } from '../tools/ai-tool.types'

import { AiRunTerminalReason } from './ai-run.constants'
import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { RunLeaseLostError } from './ai-run-guard.service'

import { canonicalJsonEqual } from '@/common/utils/canonical-json'
import {
  AiRunStepType,
  AiToolInvocationStatus,
  type AiToolRiskClass,
  Prisma,
} from '@/generated/prisma/client'

/**
 * Durable tool-action bookkeeping (Track C — ADR-054, E12 minimal contract). Every function takes the
 * OPEN guarded transaction in which the run row is already locked and its lease verified, so none of
 * them can be reached by a stale executor. One requested action is exactly one invocation row,
 * identified by `(runId, originCall)`; start and application are one-shot compare-and-set steps.
 */

export const INVOCATION_SELECT = {
  id: true,
  toolId: true,
  riskClass: true,
  idempotency: true,
  status: true,
  executionEpoch: true,
  argsSnapshot: true,
  originCall: true,
  errorCode: true,
  appliedAt: true,
} as const

export type InvocationRow = Prisma.AiToolInvocationGetPayload<{ select: typeof INVOCATION_SELECT }>

/** What happened when a holder tried to start (or adopt) an invocation's execution. */
export type StartOutcome =
  | 'started' // REQUESTED/APPROVED → EXECUTING under this epoch: run the tool
  | 'adopted' // a read-only EXECUTING of an older epoch, re-owned by this epoch: safe to repeat
  | 'in_progress' // already EXECUTING under THIS epoch: a competing continuation owns it
  | 'unknown' // an older-epoch side-effecting EXECUTING (or OUTCOME_UNKNOWN): the run is failed uncertain
  | 'gone' // no longer startable

/** The persisted idempotency class; a NULL (legacy) class is always treated as side-effecting. */
export function isReadOnly(row: Pick<InvocationRow, 'idempotency'>): boolean {
  return row.idempotency === 'read_only'
}

export function findByOrigin(
  tx: Prisma.TransactionClient,
  runId: string,
  originCall: number
): Promise<InvocationRow | null> {
  return tx.aiToolInvocation.findFirst({
    where: { runId, originCall },
    select: INVOCATION_SELECT,
  })
}

/** How many provider calls the run has durably recorded (the next call's ordinal is this + 1). */
export function providerCallCount(tx: Prisma.TransactionClient, runId: string): Promise<number> {
  return tx.aiRunStep.count({ where: { runId, type: AiRunStepType.PROVIDER_CALL } })
}

/** Create the durable intent of a requested SAFE action (`REQUESTED`, frozen normalized input). */
export function createRequested(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  tool: AiTool,
  originCall: number,
  args: unknown
): Promise<InvocationRow> {
  return tx.aiToolInvocation.create({
    data: {
      runId: claim.id,
      toolId: tool.toolId,
      status: AiToolInvocationStatus.REQUESTED,
      riskClass: tool.riskClass,
      idempotency: tool.idempotency,
      originCall,
      argsSnapshot: args as Prisma.InputJsonValue,
    },
    select: INVOCATION_SELECT,
  })
}

/** A reused invocation must carry the SAME normalized input as the new request, else fail closed. */
export function sameAction(existing: InvocationRow, toolId: string, args: unknown): boolean {
  return existing.toolId === toolId && canonicalJsonEqual(existing.argsSnapshot, args)
}

/**
 * One-shot start: `REQUESTED|APPROVED → EXECUTING` stamping this epoch. A repeat inside the same epoch
 * is `in_progress` (never a second physical call). An `EXECUTING` row of an older epoch is adopted only
 * if the tool is `read_only`; a side-effecting one becomes `OUTCOME_UNKNOWN` and the run fails uncertain
 * IN THIS TRANSACTION — nothing is re-executed and the model is not re-asked.
 */
export async function startExecution(
  tx: Prisma.TransactionClient,
  repository: AiRunRepository,
  claim: ClaimedRun,
  action: InvocationRow
): Promise<StartOutcome> {
  const started = await tx.aiToolInvocation.updateMany({
    where: {
      id: action.id,
      status: { in: [AiToolInvocationStatus.REQUESTED, AiToolInvocationStatus.APPROVED] },
    },
    data: {
      status: AiToolInvocationStatus.EXECUTING,
      executionEpoch: claim.epoch,
      startedAt: new Date(),
    },
  })
  if (started.count === 1) return 'started'

  const current = await tx.aiToolInvocation.findUnique({
    where: { id: action.id },
    select: { status: true, executionEpoch: true, idempotency: true },
  })
  if (current === null) return 'gone'
  if (current.status === AiToolInvocationStatus.EXECUTING) {
    if (current.executionEpoch === claim.epoch) return 'in_progress'
    if (isReadOnly(current)) {
      const adopted = await tx.aiToolInvocation.updateMany({
        where: {
          id: action.id,
          status: AiToolInvocationStatus.EXECUTING,
          executionEpoch: { not: claim.epoch },
        },
        data: { executionEpoch: claim.epoch, startedAt: new Date() },
      })
      return adopted.count === 1 ? 'adopted' : 'in_progress'
    }
    await tx.aiToolInvocation.updateMany({
      where: { id: action.id, status: AiToolInvocationStatus.EXECUTING },
      data: {
        status: AiToolInvocationStatus.OUTCOME_UNKNOWN,
        errorCode: 'tool_effect_unknown',
        finishedAt: new Date(),
      },
    })
  } else if (current.status !== AiToolInvocationStatus.OUTCOME_UNKNOWN) {
    return 'gone'
  }
  const won = await repository.finalizeFailed(
    tx,
    claim,
    'tool_loop_failed',
    AiRunTerminalReason.TOOL_EFFECT_UNKNOWN
  )
  if (!won) throw new RunLeaseLostError()
  return 'unknown'
}

/**
 * Record a tool's `SUCCEEDED` result under the epoch that started it. When `apply` is true the result is
 * also applied to the run transcript — `appliedAt` and the ordering `TOOL_INVOCATION` step in the SAME
 * transaction, so a result is applied exactly once. When a stop cause is visible (`apply` false) the
 * known outcome is still recorded but not applied to a transcript the run will never continue.
 */
export async function recordSuccess(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  action: InvocationRow,
  result: { output: string; durationMs: number; toolCallId: string },
  apply: boolean
): Promise<void> {
  const now = new Date()
  const cas = await tx.aiToolInvocation.updateMany({
    where: {
      id: action.id,
      status: AiToolInvocationStatus.EXECUTING,
      executionEpoch: claim.epoch,
      appliedAt: null,
    },
    data: {
      status: AiToolInvocationStatus.SUCCEEDED,
      resultSummary: { output: result.output } satisfies Prisma.InputJsonValue,
      finishedAt: now,
      durationMs: result.durationMs,
      ...(apply ? { appliedAt: now } : {}),
    },
  })
  if (cas.count !== 1) throw new RunLeaseLostError()
  if (apply) await writeToolStep(tx, claim.id, action.id, result.toolCallId, result.durationMs)
}

/** Record a tool's non-success outcome (`FAILED` no-effect/read-only, or `OUTCOME_UNKNOWN`) under its epoch. */
export async function recordFailure(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  action: InvocationRow,
  outcome: {
    status: typeof AiToolInvocationStatus.FAILED | typeof AiToolInvocationStatus.OUTCOME_UNKNOWN
    errorCode: string
    durationMs: number
  }
): Promise<void> {
  const cas = await tx.aiToolInvocation.updateMany({
    where: { id: action.id, status: AiToolInvocationStatus.EXECUTING, executionEpoch: claim.epoch },
    data: {
      status: outcome.status,
      errorCode: outcome.errorCode,
      finishedAt: new Date(),
      durationMs: outcome.durationMs,
    },
  })
  if (cas.count !== 1) throw new RunLeaseLostError()
}

/**
 * Apply an owner REJECTION to the transcript exactly once: `appliedAt` CAS + the ordering step in one
 * transaction. Returns false when it was already applied (nothing is written twice).
 */
export async function applyRejection(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  action: InvocationRow,
  toolCallId: string
): Promise<boolean> {
  const cas = await tx.aiToolInvocation.updateMany({
    where: { id: action.id, status: AiToolInvocationStatus.REJECTED, appliedAt: null },
    data: { appliedAt: new Date() },
  })
  if (cas.count !== 1) return false
  await writeToolStep(tx, claim.id, action.id, toolCallId, undefined)
  return true
}

async function writeToolStep(
  tx: Prisma.TransactionClient,
  runId: string,
  invocationId: string,
  toolCallId: string,
  durationMs: number | undefined
): Promise<void> {
  const { _max } = await tx.aiRunStep.aggregate({ where: { runId }, _max: { stepNumber: true } })
  await tx.aiRunStep.create({
    data: {
      runId,
      stepNumber: (_max.stepNumber ?? 0) + 1,
      type: AiRunStepType.TOOL_INVOCATION,
      detail: { invocationId, toolCallId } satisfies Prisma.InputJsonValue,
      durationMs,
      finishedAt: new Date(),
    },
  })
}

export type { AiToolRiskClass }
