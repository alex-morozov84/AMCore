import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { AiAuthorType, AiMessageRole, AiRunStepType, Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiRunSseReason, AiRunStatusValue } from '@amcore/shared'

import { AiRunRealtimePublisher } from '../../../core/ai/realtime/ai-run-realtime.publisher'
import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiGenerateMessage, AiTextResult } from '../gateway/ai-gateway.types'
import { ModelGateway } from '../gateway/model-gateway.service'
import { scanInput } from '../guardrails/input-guard'
import { scanOutput } from '../guardrails/output-guard'
import { buildTrustBoundaryRequest } from '../guardrails/trust-boundary.builder'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailStepCategory } from './ai-run-dispatch.types'
import { sanitizeGuardrailCategories } from './guardrail-step-detail'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** The single bounded realtime reason (Track C — ADR-054, Arc C.5); no content ever rides it. */
const RUN_STATUS_CHANGED: AiRunSseReason = 'status_changed'

/** Thrown inside the finalize transaction when the CAS finds no row → roll back the transcript. */
class RunLeaseLostError extends Error {}

/** Ledger attribution snapshotted from the run's conversation (no FK; content-free). */
interface RunAttribution {
  userId: string | null
  organizationId: string | null
}

/** Everything the provider call + finalization needs, resolved during pre-flight. */
interface RunPlan {
  modelSlug: string
  /** Trusted instruction channel (Arc D structural trust boundary). */
  system: string
  /** The untrusted user turn, JSON-encoded inside the salted boundary container (Arc D). */
  messages: AiGenerateMessage[]
  /** This run's boundary marker — handed to the output guard to detect leakage (Arc D). */
  marker: string
  /**
   * Content-free findings from an input guard `flag` (Arc D). Recorded as a `GUARDRAIL_CHECK` step
   * INSIDE the success finalize transaction (never a separate pre-provider write) — empty when the
   * input allowed or the guard is `off`.
   */
  inputFlagCategories: GuardrailStepCategory[]
  attribution: RunAttribution
}

/**
 * Executes one claimed AI run (Track C — ADR-054, Arc C.4, worker role only). Between the
 * repository's `claimDueBatch` (which leased the run `RUNNING`) and a finalizer, this is the ONLY
 * place that performs provider I/O — via the worker-only `ModelGateway`, so the web DI graph never
 * gains provider-call capability.
 *
 * Per attempt it (1) honors a cancellation/deadline observed *before* the call — no provider I/O
 * then, (2) resolves the model from the run's frozen `modelSnapshot.modelSlug` (never the current
 * default), (3) loads the run's OWN input turn via `AiMessage.runId` (not by sequence), enforces the
 * Arc D guardrails — oversize + input guard (mode-gated) refuse before any provider call, then
 * assembles the structural trust boundary (untrusted text JSON-encoded in a salted container + a
 * trusted `system` instruction), (4) calls `ModelGateway.generateText` **exactly once** and runs the
 * output guard on the complete result (a leak/disclosure discards it for a safe refusal), then
 * (5) finalizes in ONE transaction: assistant
 * message + bounded steps + a run-attributed `AiUsageLedger` row + terminal `COMPLETED` CAS.
 *
 * At-least-once provider effect: if the provider succeeds but the finalize transaction fails, the
 * run is left non-terminal (still `RUNNING`) — the reaper reclaims the expired lease and recovery
 * retries, which may call the provider again. Success is never faked without a durable transcript +
 * ledger, and the terminal outcome + ledger are exactly-once because they share the CAS transaction.
 */
@Injectable()
export class AiRunExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelGateway,
    private readonly repository: AiRunRepository,
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
   * (Arc C.5). The hint is fired in a `finally` so every path — success, retry, terminal failure,
   * pre-flight short-circuit, lease loss — signals the client to refetch; a publish never affects
   * the durable outcome (status-only SSE is at-most-once, Postgres is recovery).
   */
  async execute(claim: ClaimedRun): Promise<void> {
    try {
      await this.runAttempt(claim)
    } finally {
      // Fire-and-forget: the durable transition is already committed, so the worker must NOT block
      // on Redis for a best-effort hint — a written publish can stay pending on a half-open socket
      // (see AiRunRealtimePublisher), and awaiting it would tie the worker up past the run's end.
      // `publishStatusHint` is internally catch-all, so the detached promise never rejects.
      void this.publishStatusHint(claim.id)
    }
  }

  private async runAttempt(claim: ClaimedRun): Promise<void> {
    const plan = await this.preflight(claim)
    // A null plan means pre-flight already reached a terminal/handled state (cancel, deadline,
    // bad snapshot, missing input) or the lease was lost — nothing more to do this attempt.
    if (plan === null) return

    const startedAt = performance.now()
    let result: AiTextResult
    try {
      // Exactly one provider call per attempt. `recordUsage: false` — the ledger is written durably
      // in the finalize transaction below, not best-effort here, so it cannot orphan on rollback.
      result = await this.gateway.generateText({
        modelSlug: plan.modelSlug,
        system: plan.system,
        messages: plan.messages,
        recordUsage: false,
      })
    } catch (error) {
      await this.finalizeError(claim, error)
      return
    }

    // Output guard (Arc D, always enforced — never gated by input mode). Runs on the COMPLETE output
    // before persistence; a block discards the raw output and finalizes a safe refusal instead.
    const outputVerdict = scanOutput(result.text, { marker: plan.marker })
    this.metrics.incAiGuardrailCheck('output', outputVerdict.verdict)
    if (outputVerdict.verdict === 'block') {
      await this.repository.finalizeRefusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_OUTPUT_BLOCKED,
        checkStepType: AiRunStepType.OUTPUT_VALIDATION,
        categories: outputVerdict.categories,
      })
      return
    }

    await this.finalizeSuccess(claim, plan, result, Math.round(performance.now() - startedAt))
  }

  /**
   * Publish the run's current committed status as a content-free hint (best-effort). Reads the
   * status + owner in one query; never throws (a hint failure must not affect execution) and never
   * carries a prompt/response/model slug — only the run id, the lowercase status, and the reason.
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
   * Resolve the model + input for the call, or short-circuit to a terminal transition. Returns
   * `null` when the attempt is already handled (cancelled/expired/permanent-failed or lease lost).
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
      select: { ownerUserId: true, organizationId: true },
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

    // Oversize is a structural bound — ALWAYS enforced (independent of the input guard mode).
    const maxInputChars = this.env.get('AI_GUARDRAIL_MAX_INPUT_CHARS')
    if (inputText.length > maxInputChars) {
      await this.repository.finalizeRefusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_TOO_LARGE,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
      })
      return null
    }

    // Input guard (Arc D, heuristic — gated by AI_GUARDRAIL_INPUT_MODE). `off` skips it entirely;
    // otherwise scan + count. Only `block` mode + a `block` verdict refuses (envelope/marker abuse);
    // a `flag` is carried into the plan and recorded inside the success finalize tx.
    let inputFlagCategories: GuardrailStepCategory[] = []
    const mode = this.env.get('AI_GUARDRAIL_INPUT_MODE')
    if (mode !== 'off') {
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
      if (verdict.verdict === 'flag') inputFlagCategories = verdict.categories
    }

    // Arc D structural trust boundary: the untrusted user text is JSON-encoded inside a salted
    // container in the `user` turn, and a code-owned trusted instruction goes in `system`.
    const boundary = buildTrustBoundaryRequest({ untrustedUserText: inputText, maxInputChars })

    return {
      modelSlug,
      system: boundary.system,
      messages: boundary.messages,
      marker: boundary.marker,
      inputFlagCategories,
      attribution: {
        userId: conversation.ownerUserId,
        organizationId: conversation.organizationId,
      },
    }
  }

  /**
   * Finalize a successful generation in ONE transaction: persist the assistant turn, the bounded
   * append-only step trail, the run-attributed usage ledger row, then CAS the run terminal. Any
   * failure — including a lost lease (CAS matched no row) — rolls the whole thing back, leaving the
   * run non-terminal for recovery. Nothing here logs prompt/response content.
   */
  private async finalizeSuccess(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    providerDurationMs: number
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize the append order across concurrent finalizations (two workers finishing
        // different runs on the SAME conversation) and against the producer's user-turn insert —
        // both lock this row FOR UPDATE before allocating a sequence, so `@@unique(conversationId,
        // sequence)` cannot collide and force an avoidable non-terminal run + extra provider call.
        await this.lockConversation(tx, claim.conversationId)
        const sequence = await this.nextSequence(tx, claim.conversationId)
        await tx.aiMessage.create({
          data: {
            conversationId: claim.conversationId,
            runId: claim.id,
            sequence,
            role: AiMessageRole.ASSISTANT,
            authorType: AiAuthorType.ASSISTANT,
            content: [{ type: 'text', text: result.text }] as unknown as Prisma.InputJsonValue,
          },
        })
        await this.writeSteps(tx, claim.id, result, providerDurationMs, plan.inputFlagCategories)
        await tx.aiUsageLedger.create({
          data: {
            runId: claim.id,
            conversationId: claim.conversationId,
            userId: plan.attribution.userId,
            organizationId: plan.attribution.organizationId,
            modelSlug: plan.modelSlug,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            providerReportedUsage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            } satisfies Prisma.InputJsonValue,
            usageVersion: 1,
          },
        })
        // CAS last: if the lease was reclaimed mid-flight this matches no row → roll everything back.
        const won = await this.repository.finalizeCompleted(tx, claim)
        if (!won) throw new RunLeaseLostError()
      })
    } catch (error) {
      if (error instanceof RunLeaseLostError) {
        // The reaper/another worker owns the run now; our writes rolled back. Not an error.
        this.logger.warn(
          { event: 'ai.run.finalize_lease_lost', runId: claim.id },
          'AI run lease lost during finalization; transcript rolled back'
        )
        return
      }
      // Provider already succeeded but the durable finalize failed. Leave the run RUNNING; the lease
      // expires, the reaper re-queues it, and recovery retries (provider effect is at-least-once).
      this.logger.error(
        {
          event: 'ai.run.finalize_failed',
          runId: claim.id,
          error: error instanceof Error ? error.name : 'unknown',
        },
        'AI run finalization transaction failed after a successful provider call; left non-terminal for recovery'
      )
    }
  }

  /** Map a gateway failure to a terminal (permanent) or re-queued (retryable) transition. */
  private async finalizeError(claim: ClaimedRun, error: unknown): Promise<void> {
    if (error instanceof AiGatewayException) {
      if (error.retryable) {
        await this.repository.finalizeRetry(this.prisma, claim, error.code)
      } else {
        await this.repository.finalizeFailed(this.prisma, claim, error.code)
      }
      return
    }
    // The gateway normalizes every provider fault to AiGatewayException, so this is unexpected;
    // retry defensively rather than burning the run on an executor-side glitch.
    this.logger.error(
      { event: 'ai.run.unexpected_error', runId: claim.id },
      'Unexpected non-gateway error during AI run execution; scheduling retry'
    )
    await this.repository.finalizeRetry(this.prisma, claim, AiRunErrorCode.UNKNOWN_ERROR)
  }

  /**
   * Bounded, content-free step trail for a successful run: an optional input `GUARDRAIL_CHECK`
   * (only when the input guard flagged — written HERE, in the finalize tx, not as a separate
   * pre-provider write), then the provider call and the finalization marker. The check step carries
   * only bounded category codes + counts.
   */
  private async writeSteps(
    tx: Prisma.TransactionClient,
    runId: string,
    result: AiTextResult,
    providerDurationMs: number,
    inputFlagCategories: GuardrailStepCategory[]
  ): Promise<void> {
    let stepNumber = await this.nextStepNumber(tx, runId)
    const steps: Prisma.AiRunStepCreateManyInput[] = []
    // Sanitize at THIS write boundary too (not only in finalizeRefusal) so the content-free
    // invariant holds on every guardrail step-detail persistence path (Arc D.4 review).
    const flagged = sanitizeGuardrailCategories(inputFlagCategories)
    if (flagged.length > 0) {
      steps.push({
        runId,
        stepNumber: stepNumber++,
        type: AiRunStepType.GUARDRAIL_CHECK,
        detail: { categories: flagged } as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      })
    }
    steps.push(
      {
        runId,
        stepNumber: stepNumber++,
        type: AiRunStepType.PROVIDER_CALL,
        detail: {
          finishReason: result.finishReason,
          providerType: result.providerType,
        } satisfies Prisma.InputJsonValue,
        durationMs: providerDurationMs,
        finishedAt: new Date(),
      },
      {
        runId,
        stepNumber: stepNumber++,
        type: AiRunStepType.FINALIZATION,
        finishedAt: new Date(),
      }
    )
    await tx.aiRunStep.createMany({ data: steps })
  }

  /** Row-lock the conversation so concurrent transcript appends serialize (mirrors the producer). */
  private async lockConversation(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "ai"."ai_conversations" WHERE id = ${conversationId} FOR UPDATE
    `)
  }

  private async nextSequence(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<number> {
    const { _max } = await tx.aiMessage.aggregate({
      where: { conversationId },
      _max: { sequence: true },
    })
    return (_max.sequence ?? -1) + 1
  }

  private async nextStepNumber(tx: Prisma.TransactionClient, runId: string): Promise<number> {
    const { _max } = await tx.aiRunStep.aggregate({
      where: { runId },
      _max: { stepNumber: true },
    })
    return (_max.stepNumber ?? 0) + 1
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
