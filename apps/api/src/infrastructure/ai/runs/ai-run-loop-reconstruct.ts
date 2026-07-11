import { AiRunStepType, AiToolInvocationStatus, type Prisma } from '@prisma/client'

import type { CompletedToolRound } from './ai-run-transcript'

import type { PrismaService } from '@/prisma'

/**
 * Crash-safe transcript reconstruction for the bounded tool loop (Track C — ADR-054, Arc E). Reads
 * the run's durable state so a resumed attempt replays exactly what a committed one would — invariant
 * 6 (the step bound is the **provider-call** count) and invariant 7 (only already-`SUCCEEDED`
 * invocations are replayed; an incomplete/failed one is never fed back or re-executed).
 */

/** Completed tool rounds in `TOOL_INVOCATION` step order, joined to their SUCCEEDED invocations. */
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
      status: AiToolInvocationStatus.SUCCEEDED,
    },
    select: { id: true, toolId: true, argsSnapshot: true, resultSummary: true },
  })
  const byId = new Map(invocations.map((inv) => [inv.id, inv]))

  const rounds: CompletedToolRound[] = []
  for (const ref of refs) {
    const inv = byId.get(ref.invocationId)
    if (inv === undefined) continue // skip a non-SUCCEEDED invocation (invariant 7)
    rounds.push({
      toolCallId: ref.toolCallId,
      toolId: inv.toolId,
      input: inv.argsSnapshot,
      output: extractOutput(inv.resultSummary),
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
