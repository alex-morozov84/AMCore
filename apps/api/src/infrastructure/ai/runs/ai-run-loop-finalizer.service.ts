import { Injectable } from '@nestjs/common'
import { AiRunStepType, Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult } from '../gateway/ai-gateway.types'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailStepCategory } from './ai-run-dispatch.types'
import {
  providerCallStep,
  type RunStepSpec,
  writeAssistantTurn,
  writeRunSteps,
  writeUsageLedger,
} from './ai-run-loop-persistence'
import type { RunPlan } from './ai-run-plan'
import { sanitizeGuardrailCategories } from './guardrail-step-detail'

import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** Thrown inside a finalize transaction when the CAS finds no row → roll back the transcript. */
class RunLeaseLostError extends Error {}

/**
 * Owns every terminal (and per-call) durable write for the bounded tool loop (Track C — ADR-054, Arc
 * E.4b, worker role only), so `AiRunLoopExecutor` stays pure orchestration. Each provider call commits
 * exactly one `PROVIDER_CALL` step + run-attributed `AiUsageLedger` row (invariant 13); the terminal
 * transition is the Arc C CAS in the SAME transaction, so a lost lease rolls the whole transcript back
 * (recovery re-runs). Nothing here logs prompt/response content; the loop-steps metric is bounded.
 */
@Injectable()
export class AiRunLoopFinalizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiRunRepository,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunLoopFinalizer.name)
  }

  /** Final text answer: assistant turn + step trail + per-call ledger + terminal CAS, in ONE tx. */
  async success(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number,
    providerCalls: number
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await writeAssistantTurn(tx, claim, result.text)
        await writeRunSteps(tx, claim.id, this.successSteps(plan, result, durationMs))
        await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
        if (!(await this.repository.finalizeCompleted(tx, claim))) throw new RunLeaseLostError()
      })
      this.metrics.observeAiToolLoopSteps('completed', providerCalls)
    } catch (error) {
      this.handleFinalizeError(error, claim)
    }
  }

  /** A provider call happened but its response is a terminal policy failure: record it + fail, one tx. */
  async afterProviderFailure(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number,
    reason: string,
    providerCalls: number
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
        await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
        if (
          !(await this.repository.finalizeFailed(
            tx,
            claim,
            AiRunErrorCode.TOOL_LOOP_FAILED,
            reason
          ))
        ) {
          throw new RunLeaseLostError()
        }
      })
      this.metrics.observeAiToolLoopSteps('failed', providerCalls)
    } catch (error) {
      this.handleFinalizeError(error, claim)
    }
  }

  /** Intermediate provider call that led to a SAFE tool dispatch: its own step + ledger tx (no CAS). */
  async recordProviderCall(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
      await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
    })
  }

  /** Step bound hit before a call this iteration → terminal FAILED (no provider call to ledger). */
  async exhausted(claim: ClaimedRun, providerCalls: number): Promise<void> {
    await this.repository.finalizeFailed(
      this.prisma,
      claim,
      AiRunErrorCode.TOOL_LOOP_FAILED,
      AiRunTerminalReason.TOOL_LOOP_EXHAUSTED
    )
    this.metrics.observeAiToolLoopSteps('exhausted', providerCalls)
  }

  /** The SAFE tool failed host-side (its invocation is already durable): terminal FAILED CAS. */
  async dispatchFailed(claim: ClaimedRun, reason: string, providerCalls: number): Promise<void> {
    await this.repository.finalizeFailed(
      this.prisma,
      claim,
      AiRunErrorCode.TOOL_LOOP_FAILED,
      reason
    )
    this.metrics.observeAiToolLoopSteps('failed', providerCalls)
  }

  /** Output guard blocked the model text (Arc D): discard it, canned refusal, terminal FAILED. */
  async outputBlocked(
    claim: ClaimedRun,
    categories: GuardrailStepCategory[],
    providerCalls: number
  ): Promise<void> {
    await this.repository.finalizeRefusal(claim, {
      reasonCode: AiRunTerminalReason.GUARDRAIL_OUTPUT_BLOCKED,
      checkStepType: AiRunStepType.OUTPUT_VALIDATION,
      categories,
    })
    this.metrics.observeAiToolLoopSteps('failed', providerCalls)
  }

  /** Map a gateway failure to a retry (retryable) or terminal FAILED (permanent), mirroring Arc C. */
  async gatewayError(claim: ClaimedRun, error: unknown): Promise<void> {
    if (error instanceof AiGatewayException) {
      if (error.retryable) await this.repository.finalizeRetry(this.prisma, claim, error.code)
      else await this.repository.finalizeFailed(this.prisma, claim, error.code)
      return
    }
    this.logger.error(
      { event: 'ai.run.unexpected_error', runId: claim.id },
      'Unexpected non-gateway error during AI run loop; scheduling retry'
    )
    await this.repository.finalizeRetry(this.prisma, claim, AiRunErrorCode.UNKNOWN_ERROR)
  }

  /** Success step trail: an optional flagged input `GUARDRAIL_CHECK`, then this call + finalization. */
  private successSteps(plan: RunPlan, result: AiTextResult, durationMs: number): RunStepSpec[] {
    const steps: RunStepSpec[] = []
    const flagged = sanitizeGuardrailCategories(plan.inputFlagCategories)
    if (flagged.length > 0) {
      steps.push({
        type: AiRunStepType.GUARDRAIL_CHECK,
        detail: { categories: flagged } as unknown as Prisma.InputJsonValue,
      })
    }
    steps.push(providerCallStep(result, durationMs), { type: AiRunStepType.FINALIZATION })
    return steps
  }

  // (providerCallStep moved to ai-run-loop-persistence so AiRunApprovalParker shares it — Arc E.5.)

  /** A lost lease is not a failure (recovery owns the run); any other finalize fault stays retryable. */
  private handleFinalizeError(error: unknown, claim: ClaimedRun): void {
    if (error instanceof RunLeaseLostError) {
      this.logger.warn(
        { event: 'ai.run.finalize_lease_lost', runId: claim.id },
        'AI run lease lost during finalization; transcript rolled back'
      )
      return
    }
    this.logger.error(
      {
        event: 'ai.run.finalize_failed',
        runId: claim.id,
        error: error instanceof Error ? error.name : 'unknown',
      },
      'AI run loop finalization failed after a successful provider call; left non-terminal for recovery'
    )
  }
}
