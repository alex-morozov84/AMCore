import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiTextResult } from '../gateway/ai-gateway.types'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, GuardrailStepCategory } from './ai-run-dispatch.types'
import { AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'
import {
  providerCallStep,
  type RunStepSpec,
  writeAssistantTurn,
  writeRunSteps,
  writeUsageLedger,
} from './ai-run-loop-persistence'
import type { RunPlan } from './ai-run-plan'
import { AiRunStopSignal } from './ai-run-provider-call'
import { AiRunTransitions, applyStop } from './ai-run-transitions.service'
import { sanitizeGuardrailCategories } from './guardrail-step-detail'

import { AiRunStepType, Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'

/**
 * Owns every terminal (and per-call) durable write of the bounded tool loop (Track C — ADR-054, Arc E,
 * worker role only), so `AiRunLoopExecutor` stays pure orchestration. Every write runs inside the run
 * guard in `record` mode: a stale holder writes nothing, the lease/epoch are verified under row locks
 * with fresh database time, and each terminal transition also closes the attempt-history row. When a stop
 * cause (cancel, takeover, deadline) is visible, the call's provider step and usage ledger row are still
 * recorded — that spend happened — but no assistant turn is written and the run terminalizes as the stop.
 * Nothing here logs prompt/response content; the loop-steps metric is bounded.
 */
@Injectable()
export class AiRunLoopFinalizer {
  constructor(
    private readonly guard: AiRunGuard,
    private readonly repository: AiRunRepository,
    private readonly transitions: AiRunTransitions,
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
    const outcome = await this.guard.record(claim, async (tx, ctx) => {
      if (ctx.stop) {
        await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
        await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
        await applyStop(tx, this.repository, claim, ctx.stop)
        return false
      }
      await writeAssistantTurn(tx, claim, result.text)
      await writeRunSteps(tx, claim.id, this.successSteps(plan, result, durationMs))
      await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
      if (!(await this.repository.finalizeCompleted(tx, claim))) throw new RunLeaseLostError()
      return true
    })
    if (outcome.kind === 'ok' && outcome.value) {
      this.metrics.observeAiToolLoopSteps('completed', providerCalls)
    } else {
      this.logNotCommitted(claim, outcome.kind)
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
    const outcome = await this.guard.record(claim, async (tx, ctx) => {
      await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
      await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
      if (ctx.stop) return applyStop(tx, this.repository, claim, ctx.stop)
      if (
        !(await this.repository.finalizeFailed(tx, claim, AiRunErrorCode.TOOL_LOOP_FAILED, reason))
      ) {
        throw new RunLeaseLostError()
      }
    })
    if (outcome.kind === 'ok') this.metrics.observeAiToolLoopSteps('failed', providerCalls)
    else this.logNotCommitted(claim, outcome.kind)
  }

  /** Step bound hit before a call this iteration → terminal FAILED (no provider call to ledger). */
  async exhausted(claim: ClaimedRun, providerCalls: number): Promise<void> {
    const result = await this.transitions.failed(
      claim,
      AiRunErrorCode.TOOL_LOOP_FAILED,
      AiRunTerminalReason.TOOL_LOOP_EXHAUSTED
    )
    if (result === 'applied') this.metrics.observeAiToolLoopSteps('exhausted', providerCalls)
  }

  /** Output guard blocked the model text (Arc D): discard it, canned refusal, terminal FAILED. */
  async outputBlocked(
    claim: ClaimedRun,
    categories: GuardrailStepCategory[],
    providerCalls: number
  ): Promise<void> {
    const result = await this.transitions.refusal(claim, {
      reasonCode: AiRunTerminalReason.GUARDRAIL_OUTPUT_BLOCKED,
      checkStepType: AiRunStepType.OUTPUT_VALIDATION,
      categories,
    })
    if (result === 'applied') this.metrics.observeAiToolLoopSteps('failed', providerCalls)
  }

  /**
   * Map a provider failure to a retry (retryable) or terminal FAILED (permanent), mirroring Arc C. A visible
   * stop cause (a takeover or a recorded cancel during the failing call) wins: the guard terminalizes the
   * stop instead of scheduling a retry or writing a stale FAILED. An abort the caller itself caused (run
   * deadline) is handled by the loop before this is reached and is never retried as a provider fault.
   */
  async gatewayError(claim: ClaimedRun, error: unknown): Promise<void> {
    if (error instanceof AiGatewayException) {
      if (error.retryable) await this.transitions.retry(claim, error.code)
      else await this.transitions.failed(claim, error.code)
      return
    }
    this.logger.error(
      { event: 'ai.run.unexpected_error', runId: claim.id },
      'Unexpected non-gateway error during AI run loop; scheduling retry'
    )
    await this.transitions.retry(claim, AiRunErrorCode.UNKNOWN_ERROR)
  }

  /** The caller's own abort fired during a provider call: terminalize the (precedence-resolved) stop. */
  async callerAborted(claim: ClaimedRun, signal: AiRunStopSignal): Promise<void> {
    if (signal === 'shutdown') return // sealed: nothing is written; lease expiry recovers the run
    await this.transitions.settleStop(claim, 'expired')
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

  /** A lost lease is not a failure (recovery owns the run); log it with bounded fields only. */
  private logNotCommitted(claim: ClaimedRun, kind: string): void {
    this.logger.warn(
      { event: 'ai.run.finalize_not_committed', runId: claim.id, kind },
      'AI run finalization not committed (lease lost, shutdown or stop); nothing was written'
    )
  }
}
