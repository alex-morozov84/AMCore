import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AiGatewayException } from '../gateway/ai-gateway.error'
import type { AiGatewayTool, AiTextResult, AiToolCall } from '../gateway/ai-gateway.types'
import { ModelGateway } from '../gateway/model-gateway.service'
import { GUARDRAIL_BOUNDARY_TAG_PREFIX } from '../guardrails/guardrail.constants'
import { scanOutput } from '../guardrails/output-guard'
import {
  generateBoundaryNonce,
  toolResultBoundaryPolicy,
} from '../guardrails/trust-boundary.builder'
import type { AiTool, AiToolDescriptor } from '../tools/ai-tool.types'
import { AiToolRegistry } from '../tools/ai-tool-registry.service'

import { AiRunTerminalReason } from './ai-run.constants'
import { AiRunApprovalParker } from './ai-run-approval-parker.service'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunGuard } from './ai-run-guard.service'
import { AiRunLoopFinalizer } from './ai-run-loop-finalizer.service'
import { countProviderCalls, reconstructRounds } from './ai-run-loop-reconstruct'
import type { RunPlan } from './ai-run-plan'
import { abortCause, callProvider, ProviderCallBoundError } from './ai-run-provider-call'
import { reconstructLoopMessages } from './ai-run-transcript'
import { AiRunTransitions } from './ai-run-transitions.service'
import { AiToolActionService, type ToolRunContext } from './ai-tool-action.service'
import { AiToolRecoveryService } from './ai-tool-recovery.service'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import type { AttemptRuntime } from '@/infrastructure/worker-lifecycle'
import { PrismaService } from '@/prisma'

/** What one provider step resolved to after the output guard passed. */
type StepDecision =
  | { kind: 'final' }
  | { kind: 'fail'; reason: string }
  | { kind: 'execute'; tool: AiTool; call: AiToolCall }
  | { kind: 'approval'; tool: AiTool; call: AiToolCall }

/**
 * Bounded, durable, host-controlled tool loop (Track C — ADR-054, Arc E.4b/E.5, worker role only). At the
 * start of every epoch it first resolves any unfinished tool action (`AiToolRecoveryService`) — the model
 * is never re-asked while an action is pending — then reconstructs the transcript from Postgres. Per step
 * it ADMITS the next provider call through the run guard (a recorded cancel, a takeover, a passed
 * deadline, a lost lease or a closed dispatcher refuses it), calls the provider **once** with the run's
 * remaining lifetime folded into the abort signal, runs the Arc D output guard over every active marker,
 * and either finalizes the final text (`COMPLETED`), executes at most **one** tool call durably
 * (`AiToolActionService`), or **parks** an allowed non-SAFE call behind a human approval
 * (`AiRunApprovalParker`). Every durable write is delegated and runs inside the guard; the loop is
 * bounded by `AI_TOOL_LOOP_MAX_STEPS` and the run lifetime.
 */
@Injectable()
export class AiRunLoopExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelGateway,
    private readonly guard: AiRunGuard,
    private readonly transitions: AiRunTransitions,
    private readonly registry: AiToolRegistry,
    private readonly actions: AiToolActionService,
    private readonly recovery: AiToolRecoveryService,
    private readonly finalizer: AiRunLoopFinalizer,
    private readonly parker: AiRunApprovalParker,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunLoopExecutor.name)
  }

  /** Run the bounded loop for one claimed attempt to a terminal transition (or stop on lease loss). */
  async run(claim: ClaimedRun, plan: RunPlan, runtime: AttemptRuntime): Promise<void> {
    const ctx: ToolRunContext = {
      claim,
      ownerUserId: plan.attribution.userId ?? '',
      organizationId: plan.attribution.organizationId,
      runtime,
    }

    // Resolve a pending/stranded tool action BEFORE anything else (and before the model is asked again).
    if ((await this.recovery.recover(ctx)) === 'done') return

    // Reconstruct BEFORE building the step: even when the current allowlist offers no tools, prior
    // applied tool rounds must still carry the tool-result boundary marker + policy.
    const rounds = await reconstructRounds(this.prisma, claim.id)
    let providerCalls = await countProviderCalls(this.prisma, claim.id)
    const setup = this.buildStep(plan, rounds.length > 0)
    const maxSteps = this.env.get('AI_TOOL_LOOP_MAX_STEPS')

    for (;;) {
      // Admission before EVERY provider call: lease (fresh clock), cancel, takeover, deadline, shutdown.
      const admitted = await this.guard.admit(claim, async () => undefined, { markIoStarted: true })
      if (admitted.kind === 'stopped') {
        await this.transitions.stop(claim, admitted.cause)
        return
      }
      if (admitted.kind !== 'ok') return // lease lost / dispatcher closed — nothing to write
      if (providerCalls >= maxSteps) {
        await this.finalizer.exhausted(claim, providerCalls)
        return
      }

      const messages = reconstructLoopMessages(plan.userMessages, rounds, setup.toolMarker ?? '')
      const startedAt = performance.now()
      let result: AiTextResult
      try {
        result = await callProvider(
          this.gateway,
          {
            modelSlug: plan.modelSlug,
            system: setup.system,
            messages,
            tools: setup.tools,
            recordUsage: false,
          },
          { claim, runtime, timeoutMs: this.env.get('AI_REQUEST_TIMEOUT_MS') }
        )
      } catch (error) {
        await this.handleProviderError(claim, runtime, error)
        return
      }
      providerCalls += 1
      const ordinal = providerCalls
      const durationMs = Math.round(performance.now() - startedAt)

      if (await this.blockedOutput(claim, plan, setup.toolMarker, result, providerCalls)) return

      const decision = this.classify(result.toolCalls, plan.toolAllowlist)
      if (decision.kind === 'final') {
        await this.finalizer.success(claim, plan, result, durationMs, providerCalls)
        return
      }
      if (decision.kind === 'fail') {
        await this.finalizer.afterProviderFailure(
          claim,
          plan,
          result,
          durationMs,
          decision.reason,
          providerCalls
        )
        return
      }

      // An allowed tool call: validate its args once; the validated (normalized) data is the frozen action.
      const parsed = decision.tool.parameters.safeParse(decision.call.input)
      if (!parsed.success) {
        await this.finalizer.afterProviderFailure(
          claim,
          plan,
          result,
          durationMs,
          AiRunTerminalReason.TOOL_ARGS_INVALID,
          providerCalls
        )
        return
      }
      if (decision.kind === 'approval') {
        // A non-SAFE call PARKS behind a durable approval; it is NOT executed until approved.
        await this.parker.park(claim, plan, result, durationMs, ordinal, decision.tool, parsed.data)
        return
      }

      const intent = await this.actions.requestAction(
        claim,
        plan,
        result,
        durationMs,
        ordinal,
        decision.tool,
        parsed.data
      )
      if (intent.kind !== 'ready') return
      const step = await this.actions.execute(
        ctx,
        intent.action,
        decision.tool,
        decision.call.toolCallId,
        parsed.data
      )
      if (step.status !== 'succeeded') return
      rounds.push({
        toolCallId: step.toolCallId,
        toolId: decision.tool.toolId,
        // The VALIDATED args (== the persisted `argsSnapshot`) so this uninterrupted round is
        // byte-identical to the same round reconstructed on a crash-resumed attempt.
        input: step.input,
        output: step.output,
      })
    }
  }

  /**
   * Map a provider-call failure. A caller abort (run deadline, or the shutdown seal) is NOT an ordinary
   * provider retry: the deadline terminalizes the run as expired (or as a higher-precedence stop), and a
   * shutdown writes nothing — the lease expires and recovery re-runs the step. A local bound breach is a
   * retryable timeout; everything else follows the gateway taxonomy.
   */
  private async handleProviderError(
    claim: ClaimedRun,
    runtime: AttemptRuntime,
    error: unknown
  ): Promise<void> {
    if (error instanceof AiGatewayException && error.code === 'aborted') {
      await this.finalizer.callerAborted(claim, abortCause(runtime))
      return
    }
    if (error instanceof ProviderCallBoundError) {
      await this.transitions.retry(claim, 'provider_timeout')
      return
    }
    await this.finalizer.gatewayError(claim, error)
  }

  /**
   * Resolve the per-run step invariants once: the allowlisted tools offered to the model, and — when
   * tools apply OR prior tool rounds must be replayed — a distinct tool-result boundary marker (Arc D
   * reuse) + the augmented trusted instruction. Offering no current tools (empty allowlist) still keeps
   * the boundary if `hasPriorRounds`, so a resumed transcript never wraps a tool result under an empty
   * marker. No tools and no prior rounds ⇒ the Arc C single-call text path.
   */
  private buildStep(
    plan: RunPlan,
    hasPriorRounds: boolean
  ): { system: string; tools: AiGatewayTool[] | undefined; toolMarker: string | undefined } {
    const descriptors = this.registry.describeAllowed(plan.toolAllowlist)
    if (descriptors.length === 0 && !hasPriorRounds) {
      return { system: plan.system, tools: undefined, toolMarker: undefined }
    }
    const toolMarker = `${GUARDRAIL_BOUNDARY_TAG_PREFIX}tool-${generateBoundaryNonce()}`
    return {
      system: `${plan.system}\n\n${toolResultBoundaryPolicy(toolMarker)}`,
      tools: descriptors.length > 0 ? descriptors.map(toGatewayTool) : undefined,
      toolMarker,
    }
  }

  /**
   * Run the Arc D output guard over EVERY active marker (invariant 5) — the user-input marker and, when
   * present, the tool-result marker. On a block, discard the output and finalize a safe refusal.
   */
  private async blockedOutput(
    claim: ClaimedRun,
    plan: RunPlan,
    toolMarker: string | undefined,
    result: AiTextResult,
    providerCalls: number
  ): Promise<boolean> {
    const markers = toolMarker ? [plan.marker, toolMarker] : [plan.marker]
    const verdict = scanOutput(result.text, { markers })
    this.metrics.incAiGuardrailCheck('output', verdict.verdict)
    if (verdict.verdict !== 'block') return false
    await this.finalizer.outputBlocked(claim, verdict.categories, providerCalls)
    return true
  }

  /** Classify a provider step's tool calls (≤1 allowed call — invariant 5). */
  private classify(toolCalls: AiToolCall[], allowlist: string[]): StepDecision {
    if (toolCalls.length === 0) return { kind: 'final' }
    if (toolCalls.length > 1)
      return { kind: 'fail', reason: AiRunTerminalReason.TOO_MANY_TOOL_CALLS }
    const call = toolCalls[0]!
    const tool = this.registry.get(call.toolName)
    if (tool === undefined || !allowlist.includes(tool.toolId)) {
      return { kind: 'fail', reason: AiRunTerminalReason.TOOL_NOT_ALLOWED }
    }
    // A non-SAFE (SENSITIVE/DESTRUCTIVE) call parks behind a durable human approval (Arc E.5) — never
    // executed inline. A SAFE call runs host-side immediately.
    if (this.registry.requiresApproval(tool)) return { kind: 'approval', tool, call }
    return { kind: 'execute', tool, call }
  }
}

/** Map an allowed tool descriptor to the provider-agnostic gateway tool shape (no `execute`). */
function toGatewayTool(descriptor: AiToolDescriptor): AiGatewayTool {
  return {
    name: descriptor.toolId,
    description: descriptor.description,
    parameters: descriptor.parameters,
  }
}
