import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { AiAuthorType, AiMessageRole, AiRunStepType, Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiGenerateMessage, AiTextResult } from '../gateway/ai-gateway.types'
import { ModelGateway } from '../gateway/model-gateway.service'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'

import { PrismaService } from '@/prisma'

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
  messages: AiGenerateMessage[]
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
 * default), (3) loads the run's OWN input turn via `AiMessage.runId` (not by sequence), (4) calls
 * `ModelGateway.generateText` **exactly once**, then (5) finalizes in ONE transaction: assistant
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
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunExecutorService.name)
  }

  /** Run one attempt of a claimed run to a terminal transition (or leave it non-terminal to retry). */
  async execute(claim: ClaimedRun): Promise<void> {
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
        messages: plan.messages,
        recordUsage: false,
      })
    } catch (error) {
      await this.finalizeError(claim, error)
      return
    }
    await this.finalizeSuccess(claim, plan, result, Math.round(performance.now() - startedAt))
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

    return {
      modelSlug,
      messages: [{ role: 'user', content: inputText }],
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
        await this.writeSteps(tx, claim.id, result, providerDurationMs)
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

  /** Two bounded, content-free steps: the provider call and the finalization marker. */
  private async writeSteps(
    tx: Prisma.TransactionClient,
    runId: string,
    result: AiTextResult,
    providerDurationMs: number
  ): Promise<void> {
    const base = await this.nextStepNumber(tx, runId)
    await tx.aiRunStep.createMany({
      data: [
        {
          runId,
          stepNumber: base,
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
          stepNumber: base + 1,
          type: AiRunStepType.FINALIZATION,
          finishedAt: new Date(),
        },
      ],
    })
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
