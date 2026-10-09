import { AI_TOOL_REJECTION_NOTICE } from '../tools/ai-tool.constants'

import type { CompletedToolRound } from './ai-run-transcript'
import { INVOCATION_SELECT, type InvocationRow } from './ai-tool-invocation.store'

import { AiRunStepType, AiToolInvocationStatus, type Prisma } from '@/generated/prisma/client'
import { CUTOFF, type Cutoff } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

/**
 * Runs ONE database operation under the shutdown latch: sealed → not invoked, `CUTOFF`. Every query of a
 * multi-query helper goes through it individually, because a single wrapper around the whole helper would
 * let a continuation that resumes after the seal start its next query.
 */
export type FencedRun = <T>(operation: () => Promise<T>) => Promise<T | Cutoff>

/** What recovery found: nothing, exactly one action to resolve, or an inconsistent set (fail closed). */
export type UnresolvedAction = InvocationRow | 'ambiguous' | null

/**
 * The run's unresolved tool action, if any (E12 recovery). At the start of every epoch — BEFORE the model
 * is asked again — recovery evaluates what is still pending:
 *
 * 1. **Any** recorded `OUTCOME_UNKNOWN` or older-epoch side-effecting `EXECUTING` has precedence, whatever its age or what else is pending:
 *    an uncertain side effect must stop the run before anything executable continues (legacy data can hold
 *    several invocations, so "the newest one" is not enough).
 * 2. Otherwise the pending actions are `REQUESTED`/`APPROVED` (start it), `EXECUTING` (same epoch: exit;
 *    older epoch: adopt a read-only one), `REJECTED`/`SUCCEEDED` whose application marker is unset, and a
 *    `FAILED` row on a still-running run (apply its terminal policy). New code leaves at most ONE; more than
 *    one is an inconsistent legacy set and returns `'ambiguous'` (fail closed — nothing is executed).
 *
 * `null` means nothing is pending (the normal loop). `AWAITING_APPROVAL`/`SKIPPED`/applied rows are never
 * selected.
 */
/** Recorded unknown and abandoned side effects dominate all ordinary preflight failures. */
export function findUncertainAction(
  prisma: Pick<PrismaService, 'aiToolInvocation'>,
  runId: string,
  epoch: number,
  run: FencedRun
): Promise<InvocationRow | null | Cutoff> {
  return run(() =>
    prisma.aiToolInvocation.findFirst({
      where: {
        runId,
        OR: [
          { status: AiToolInvocationStatus.OUTCOME_UNKNOWN },
          {
            status: AiToolInvocationStatus.EXECUTING,
            AND: [
              { OR: [{ executionEpoch: null }, { executionEpoch: { lt: epoch } }] },
              { OR: [{ idempotency: null }, { idempotency: { not: 'read_only' } }] },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: INVOCATION_SELECT,
    })
  )
}

export async function findUnresolvedAction(
  prisma: PrismaService,
  runId: string,
  run: FencedRun,
  epoch: number
): Promise<UnresolvedAction | Cutoff> {
  const unknown = await findUncertainAction(prisma, runId, epoch, run)
  if (unknown === CUTOFF || unknown !== null) return unknown
  const pending = await run(() =>
    prisma.aiToolInvocation.findMany({
      where: {
        runId,
        OR: [
          {
            status: {
              in: [
                AiToolInvocationStatus.REQUESTED,
                AiToolInvocationStatus.APPROVED,
                AiToolInvocationStatus.EXECUTING,
                AiToolInvocationStatus.FAILED,
              ],
            },
          },
          {
            status: { in: [AiToolInvocationStatus.SUCCEEDED, AiToolInvocationStatus.REJECTED] },
            appliedAt: null,
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: INVOCATION_SELECT,
      take: 2,
    })
  )
  if (pending === CUTOFF) return CUTOFF
  if (pending.length > 1) return 'ambiguous'
  return pending[0] ?? null
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
  runId: string,
  run: FencedRun
): Promise<CompletedToolRound[] | Cutoff> {
  const steps = await run(() =>
    prisma.aiRunStep.findMany({
      where: { runId, type: AiRunStepType.TOOL_INVOCATION },
      orderBy: { stepNumber: 'asc' },
      select: { detail: true },
    })
  )
  if (steps === CUTOFF) return CUTOFF
  const refs = steps.map((step) => parseToolStepDetail(step.detail)).filter(isPresent)
  if (refs.length === 0) return []

  const invocations = await run(() =>
    prisma.aiToolInvocation.findMany({
      where: {
        id: { in: refs.map((ref) => ref.invocationId) },
        status: { in: [AiToolInvocationStatus.SUCCEEDED, AiToolInvocationStatus.REJECTED] },
      },
      select: { id: true, toolId: true, status: true, argsSnapshot: true, resultSummary: true },
    })
  )
  if (invocations === CUTOFF) return CUTOFF
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
