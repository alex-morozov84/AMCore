import { Injectable } from '@nestjs/common'
import { AiMessageRole, AiRunStepType, Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiRunSseReason, AiRunStatusValue } from '@amcore/shared'

import { AiRunRealtimePublisher } from '../../../core/ai/realtime/ai-run-realtime.publisher'
import { scanInput } from '../guardrails/input-guard'
import { buildTrustBoundaryRequest } from '../guardrails/trust-boundary.builder'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailStepCategory } from './ai-run-dispatch.types'
import { AiRunLoopExecutor } from './ai-run-loop-executor.service'
import type { RunPlan } from './ai-run-plan'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** The single bounded realtime reason (Track C — ADR-054, Arc C.5); no content ever rides it. */
const RUN_STATUS_CHANGED: AiRunSseReason = 'status_changed'

/**
 * Executes one claimed AI run (Track C — ADR-054, Arc C.4/E.4b, worker role only). This is the thin
 * outer shell: it honors a cancellation/deadline observed before any provider I/O, resolves the run's
 * frozen model + own input turn, enforces the Arc D **input**-side guardrails (oversize + input guard
 * refuse before any provider call), assembles the structural trust boundary, resolves the bound
 * assistant's tool allowlist, and hands the resulting plan to the worker-only `AiRunLoopExecutor` —
 * which owns all provider I/O, the bounded SAFE tool loop, the output guard, and every terminal
 * transition. A single best-effort, content-free status hint is emitted for every path.
 */
@Injectable()
export class AiRunExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiRunRepository,
    private readonly loop: AiRunLoopExecutor,
    private readonly publisher: AiRunRealtimePublisher,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunExecutorService.name)
  }

  /**
   * Run one attempt of a claimed run to a terminal transition (or leave it non-terminal to retry),
   * then emit a single best-effort, content-free status hint reflecting the run's committed status
   * (Arc C.5). The hint is fired in a `finally` so every path signals the client to refetch; a publish
   * never affects the durable outcome (status-only SSE is at-most-once, Postgres is recovery).
   */
  async execute(claim: ClaimedRun): Promise<void> {
    try {
      await this.runAttempt(claim)
    } finally {
      // Fire-and-forget: the durable transition is already committed, so the worker must NOT block on
      // Redis for a best-effort hint. `publishStatusHint` is internally catch-all — it never rejects.
      void this.publishStatusHint(claim.id)
    }
  }

  private async runAttempt(claim: ClaimedRun): Promise<void> {
    const plan = await this.preflight(claim)
    // A null plan means pre-flight already reached a terminal/handled state (cancel, deadline, bad
    // snapshot, missing input, guardrail refusal) — nothing more to do this attempt.
    if (plan === null) return
    await this.loop.run(claim, plan)
  }

  /**
   * Publish the run's current committed status as a content-free hint (best-effort). Reads the status
   * + owner in one query; never throws and never carries a prompt/response/model slug.
   */
  private async publishStatusHint(runId: string): Promise<void> {
    try {
      const run = await this.prisma.aiRun.findUnique({
        where: { id: runId },
        select: { status: true, conversation: { select: { ownerUserId: true } } },
      })
      if (!run) return
      await this.publisher.publish(
        run.conversation.ownerUserId,
        runId,
        run.status.toLowerCase() as AiRunStatusValue,
        RUN_STATUS_CHANGED
      )
    } catch {
      // Best-effort: the client repairs a missed hint on its next reconnect/refetch.
    }
  }

  /**
   * Resolve the model, input, guardrails, and tool allowlist for the loop, or short-circuit to a
   * terminal transition. Returns `null` when the attempt is already handled (cancelled/expired/
   * permanent-failed/refused).
   */
  private async preflight(claim: ClaimedRun): Promise<RunPlan | null> {
    // Re-read the cooperative-cancel flag + deadline fresh (the cancel may have landed after claim).
    const run = await this.prisma.aiRun.findUnique({
      where: { id: claim.id },
      select: { cancellationRequestedAt: true, deadlineAt: true },
    })
    const now = new Date()
    if (run?.cancellationRequestedAt != null) {
      await this.repository.finalizeCancelled(
        this.prisma,
        claim,
        AiRunTerminalReason.CANCELLED_BY_USER
      )
      return null
    }
    const deadlineAt = run?.deadlineAt ?? claim.deadlineAt
    if (deadlineAt != null && deadlineAt <= now) {
      await this.repository.finalizeExpired(this.prisma, claim)
      return null
    }

    const modelSlug = modelSlugFromSnapshot(claim.modelSnapshot)
    if (modelSlug === null) {
      await this.repository.finalizeFailed(
        this.prisma,
        claim,
        AiRunErrorCode.MODEL_SNAPSHOT_INVALID
      )
      return null
    }

    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: claim.conversationId },
      select: {
        ownerUserId: true,
        organizationId: true,
        assistant: { select: { toolAllowlist: true } },
      },
    })
    // The run's OWN input turn is bound by `runId` (not the max-sequence message) so several runs
    // queued on one conversation before execution each read their own input.
    const input = await this.prisma.aiMessage.findFirst({
      where: { runId: claim.id, role: AiMessageRole.USER },
      orderBy: { sequence: 'asc' },
      select: { content: true },
    })
    if (conversation === null || input === null) {
      await this.repository.finalizeFailed(this.prisma, claim, AiRunErrorCode.INPUT_MISSING)
      return null
    }

    const inputText = extractText(input.content)
    if (inputText.length === 0) {
      await this.repository.finalizeFailed(this.prisma, claim, AiRunErrorCode.NO_INPUT_TEXT)
      return null
    }

    const inputFlagCategories = await this.runInputGuards(claim, inputText)
    if (inputFlagCategories === null) return null // oversize / block already refused

    // Arc D structural trust boundary: untrusted user text JSON-encoded in a salted container; the
    // code-owned trusted instruction goes in `system`. The loop augments `system` when tools apply.
    const maxInputChars = this.env.get('AI_GUARDRAIL_MAX_INPUT_CHARS')
    const boundary = buildTrustBoundaryRequest({ untrustedUserText: inputText, maxInputChars })
    return {
      modelSlug,
      system: boundary.system,
      userMessages: boundary.messages,
      marker: boundary.marker,
      toolAllowlist: conversation.assistant?.toolAllowlist ?? [],
      inputFlagCategories,
      attribution: {
        userId: conversation.ownerUserId,
        organizationId: conversation.organizationId,
      },
    }
  }

  /**
   * Enforce the Arc D input-side guardrails: always-on oversize, then the mode-gated heuristic input
   * scan. Returns the flag categories to record on success (empty if allowed/off), or `null` when a
   * refusal was already finalized (oversize, or a `block` verdict in `block` mode).
   */
  private async runInputGuards(
    claim: ClaimedRun,
    inputText: string
  ): Promise<GuardrailStepCategory[] | null> {
    const maxInputChars = this.env.get('AI_GUARDRAIL_MAX_INPUT_CHARS')
    if (inputText.length > maxInputChars) {
      await this.repository.finalizeRefusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_TOO_LARGE,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
      })
      return null
    }

    const mode = this.env.get('AI_GUARDRAIL_INPUT_MODE')
    if (mode === 'off') return []
    const verdict = scanInput(inputText)
    this.metrics.incAiGuardrailCheck('input', verdict.verdict)
    if (mode === 'block' && verdict.verdict === 'block') {
      await this.repository.finalizeRefusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_BLOCKED,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
        categories: verdict.categories,
      })
      return null
    }
    return verdict.verdict === 'flag' ? verdict.categories : []
  }
}

/** Read the frozen model slug from the run's secret-free snapshot; `null` if absent/malformed. */
function modelSlugFromSnapshot(snapshot: Prisma.JsonValue): string | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const slug = (snapshot as Record<string, unknown>).modelSlug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

/** Concatenate the text parts of a structured message content (Arc C is text-only). */
function extractText(content: Prisma.JsonValue): string {
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const part of content) {
    if (
      part !== null &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      (part as Record<string, unknown>).type === 'text' &&
      typeof (part as Record<string, unknown>).text === 'string'
    ) {
      texts.push((part as Record<string, unknown>).text as string)
    }
  }
  return texts.join('\n')
}
