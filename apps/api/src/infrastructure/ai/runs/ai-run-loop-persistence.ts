import type { AiTextResult } from '../gateway/ai-gateway.types'
import { usageLedgerV2 } from '../usage/ai-usage-v2'

import type { ClaimedRun } from './ai-run-dispatch.types'
import type { RunAttribution } from './ai-run-plan'

import { AiAuthorType, AiMessageRole, AiRunStepType, Prisma } from '@/generated/prisma/client'

/**
 * Free transactional-write helpers for the bounded tool loop (Track C — ADR-054, Arc E, worker role
 * only). Each takes an open `tx` so the loop executor composes them with a terminal CAS in ONE
 * transaction (per-call ledger + step trail + assistant turn commit or roll back together — the Arc C
 * atomicity property, extended to the N-step loop). Nothing here logs prompt/response content.
 */

/** One bounded, content-free append-only step to persist (mirrors the Arc C step trail). */
export interface RunStepSpec {
  type: AiRunStepType
  detail?: Prisma.InputJsonValue
  durationMs?: number
  errorCode?: string
}

/** The bounded, content-free `PROVIDER_CALL` step detail for one provider call (loop + park share it). */
export function providerCallStep(result: AiTextResult, durationMs: number): RunStepSpec {
  return {
    type: AiRunStepType.PROVIDER_CALL,
    detail: { finishReason: result.finishReason, providerType: result.providerType },
    durationMs,
  }
}

/** Append a batch of steps with contiguous `stepNumber`s allocated from the current max. */
export async function writeRunSteps(
  tx: Prisma.TransactionClient,
  runId: string,
  specs: RunStepSpec[]
): Promise<void> {
  if (specs.length === 0) return
  let stepNumber = await nextStepNumber(tx, runId)
  const now = new Date()
  await tx.aiRunStep.createMany({
    data: specs.map((spec) => ({
      runId,
      stepNumber: stepNumber++,
      type: spec.type,
      detail: spec.detail,
      durationMs: spec.durationMs,
      errorCode: spec.errorCode,
      finishedAt: now,
    })),
  })
}

/** One run-attributed usage-ledger row for a single provider call (honest per-call accounting). */
export async function writeUsageLedger(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  attribution: RunAttribution,
  modelSlug: string,
  result: AiTextResult
): Promise<void> {
  await tx.aiUsageLedger.create({
    data: {
      runId: claim.id,
      conversationId: claim.conversationId,
      userId: attribution.userId,
      organizationId: attribution.organizationId,
      modelSlug,
      ...usageLedgerV2(result.usage),
      toolCalls: result.toolCalls.length,
    },
  })
}

/**
 * Persist the final assistant text turn. It runs inside the run guard's transaction, which already holds
 * the conversation `FOR UPDATE` lock (serializing concurrent appends) and has verified the ownership
 * fence (ADR-049, Arc F): the finalizer calls this ONLY when no stop cause (cancel, takeover, deadline)
 * is visible, so no stale bot turn can land in a human-owned conversation.
 */
export async function writeAssistantTurn(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun,
  text: string
): Promise<void> {
  const sequence = await nextSequence(tx, claim.conversationId)
  await tx.aiMessage.create({
    data: {
      conversationId: claim.conversationId,
      runId: claim.id,
      sequence,
      role: AiMessageRole.ASSISTANT,
      authorType: AiAuthorType.ASSISTANT,
      content: [{ type: 'text', text }] as unknown as Prisma.InputJsonValue,
    },
  })
}

async function nextSequence(tx: Prisma.TransactionClient, conversationId: string): Promise<number> {
  const { _max } = await tx.aiMessage.aggregate({
    where: { conversationId },
    _max: { sequence: true },
  })
  return (_max.sequence ?? -1) + 1
}

async function nextStepNumber(tx: Prisma.TransactionClient, runId: string): Promise<number> {
  const { _max } = await tx.aiRunStep.aggregate({ where: { runId }, _max: { stepNumber: true } })
  return (_max.stepNumber ?? 0) + 1
}
