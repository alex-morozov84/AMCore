import { AI_TOOL_REJECTION_NOTICE } from '../tools/ai-tool.constants'

import type { CompletedToolRound } from './ai-run-transcript'

import {
  AiRunStepType,
  AiToolInvocationStatus,
  type AiToolRiskClass,
  type Prisma,
} from '@/generated/prisma/client'
import type { PrismaService } from '@/prisma'

/**
 * An approval-gated invocation whose owner decision has landed but whose effect is not yet applied to
 * the transcript (Arc E.5): status `APPROVED` (execute on resume), `EXECUTING` (a crashed execution to
 * re-apply idempotently on reclaim), or `REJECTED` with no `TOOL_INVOCATION` step yet (feed the rejection
 * notice on resume). Carries the approved `riskClass` + persisted `argsSnapshot` for re-validation.
 */
export interface PendingApprovalInvocation {
  id: string
  toolId: string
  riskClass: AiToolRiskClass
  status: AiToolInvocationStatus
  argsSnapshot: Prisma.JsonValue
}

/**
 * The run's single pending-application invocation, if any (Arc E.5, worker resume). `APPROVED` and a
 * stranded `EXECUTING` (worker crashed after the execution gate, before the SUCCEEDED commit) both need
 * execution; `REJECTED` is pending only until its `TOOL_INVOCATION` step is written. Returns `null` when
 * there is nothing to apply (normal E.4b loop).
 */
export async function findPendingApproval(
  prisma: PrismaService,
  runId: string
): Promise<PendingApprovalInvocation | null> {
  const inv = await prisma.aiToolInvocation.findFirst({
    where: {
      runId,
      status: {
        in: [
          AiToolInvocationStatus.APPROVED,
          AiToolInvocationStatus.EXECUTING,
          AiToolInvocationStatus.REJECTED,
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, toolId: true, riskClass: true, status: true, argsSnapshot: true },
  })
  if (inv === null) return null
  if (inv.status !== AiToolInvocationStatus.REJECTED) return inv // APPROVED / EXECUTING → execute on resume
  // REJECTED is applied once its ordering step exists — then reconstruction replays it (not this path).
  const step = await prisma.aiRunStep.findFirst({
    where: {
      runId,
      type: AiRunStepType.TOOL_INVOCATION,
      detail: { path: ['invocationId'], equals: inv.id },
    },
    select: { id: true },
  })
  return step === null ? inv : null
}

/**
 * Crash-safe transcript reconstruction for the bounded tool loop (Track C — ADR-054, Arc E). Reads
 * the run's durable state so a resumed attempt replays exactly what a committed one would — invariant
 * 6 (the step bound is the **provider-call** count) and invariant 7 (only an *applied* invocation is
 * replayed). An applied invocation carries a `TOOL_INVOCATION` step and is either `SUCCEEDED` (its real
 * output) or, from Arc E.5, `REJECTED` by an owner decision (a fixed content-free rejection notice). An
 * `AWAITING_APPROVAL`/`APPROVED`/`SKIPPED`/`EXECUTING`/`FAILED` invocation has no applied step and is
 * never fed back or re-executed.
 */

/** Applied tool rounds in `TOOL_INVOCATION` step order, joined to their SUCCEEDED/REJECTED invocations. */
export async function reconstructRounds(
  prisma: PrismaService,
  runId: string
): Promise<CompletedToolRound[]> {
  const steps = await prisma.aiRunStep.findMany({
    where: { runId, type: AiRunStepType.TOOL_INVOCATION },
    orderBy: { stepNumber: 'asc' },
    select: { detail: true },
  })
  const refs = steps.map((step) => parseToolStepDetail(step.detail)).filter(isPresent)
  if (refs.length === 0) return []

  const invocations = await prisma.aiToolInvocation.findMany({
    where: {
      id: { in: refs.map((ref) => ref.invocationId) },
      status: { in: [AiToolInvocationStatus.SUCCEEDED, AiToolInvocationStatus.REJECTED] },
    },
    select: { id: true, toolId: true, status: true, argsSnapshot: true, resultSummary: true },
  })
  const byId = new Map(invocations.map((inv) => [inv.id, inv]))

  const rounds: CompletedToolRound[] = []
  for (const ref of refs) {
    const inv = byId.get(ref.invocationId)
    if (inv === undefined) continue // skip a not-yet-applied invocation (invariant 7)
    rounds.push({
      toolCallId: ref.toolCallId,
      toolId: inv.toolId,
      input: inv.argsSnapshot,
      // A REJECTED round feeds the fixed rejection notice, not the (absent) tool output.
      output:
        inv.status === AiToolInvocationStatus.REJECTED
          ? AI_TOOL_REJECTION_NOTICE
          : extractOutput(inv.resultSummary),
    })
  }
  return rounds
}

/** Number of committed `PROVIDER_CALL` steps — the loop's step bound (invariant 6). */
export function countProviderCalls(prisma: PrismaService, runId: string): Promise<number> {
  return prisma.aiRunStep.count({ where: { runId, type: AiRunStepType.PROVIDER_CALL } })
}

/** Read the bounded `{ invocationId, toolCallId }` a `TOOL_INVOCATION` step carries, or `null`. */
function parseToolStepDetail(detail: Prisma.JsonValue): {
  invocationId: string
  toolCallId: string
} | null {
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return null
  const { invocationId, toolCallId } = detail as Record<string, unknown>
  if (typeof invocationId !== 'string' || typeof toolCallId !== 'string') return null
  return { invocationId, toolCallId }
}

/** Read the bounded text output stored in a SUCCEEDED invocation's `resultSummary`. */
function extractOutput(resultSummary: Prisma.JsonValue): string {
  if (resultSummary === null || typeof resultSummary !== 'object' || Array.isArray(resultSummary)) {
    return ''
  }
  const { output } = resultSummary as Record<string, unknown>
  return typeof output === 'string' ? output : ''
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
