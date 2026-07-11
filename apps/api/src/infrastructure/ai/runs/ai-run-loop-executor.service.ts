import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

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
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunLoopFinalizer } from './ai-run-loop-finalizer.service'
import { countProviderCalls, reconstructRounds } from './ai-run-loop-reconstruct'
import type { RunPlan } from './ai-run-plan'
import { reconstructLoopMessages } from './ai-run-transcript'
import { AiToolDispatcher, type ToolDispatchContext } from './ai-tool-dispatcher.service'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** What one provider step resolved to after the output guard passed. */
type StepDecision =
  | { kind: 'final' }
  | { kind: 'fail'; reason: string }
  | { kind: 'execute'; tool: AiTool; call: AiToolCall }

/**
 * Bounded, durable, host-controlled SAFE tool loop (Track C — ADR-054, Arc E.4b, worker role only).
 * It reconstructs the run's transcript from Postgres, then per step offers the bound assistant's
 * allowlisted tools, calls the provider **once**, runs the Arc D output guard over every active marker,
 * and either finalizes the final text (`COMPLETED`) or executes at most **one SAFE** tool call
 * host-side (via `AiToolDispatcher`) and loops. Every durable write is delegated to `AiRunLoopFinalizer`
 * (per-call ledger + step trail + terminal CAS); the lease is renewed each step (invariant 9) and the
 * whole loop is bounded by `AI_TOOL_LOOP_MAX_STEPS` + the run deadline. A tool call needing approval
 * terminally fails with `tool_approval_required` until Arc E.5 wires the durable park.
 */
@Injectable()
export class AiRunLoopExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelGateway,
    private readonly repository: AiRunRepository,
    private readonly registry: AiToolRegistry,
    private readonly dispatcher: AiToolDispatcher,
    private readonly finalizer: AiRunLoopFinalizer,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunLoopExecutor.name)
  }

  /** Run the bounded loop for one claimed attempt to a terminal transition (or stop on lease loss). */
  async run(claim: ClaimedRun, plan: RunPlan): Promise<void> {
    const ctx: ToolDispatchContext = {
      claim,
      ownerUserId: plan.attribution.userId ?? '',
      organizationId: plan.attribution.organizationId,
    }

    // Reconstruct BEFORE building the step: even when the current allowlist offers no tools, prior
    // SUCCEEDED tool rounds must still carry the tool-result boundary marker + policy (finding A2-2).
    const rounds = await reconstructRounds(this.prisma, claim.id)
    let providerCalls = await countProviderCalls(this.prisma, claim.id)
    const setup = this.buildStep(plan, rounds.length > 0)
    const maxSteps = this.env.get('AI_TOOL_LOOP_MAX_STEPS')

    for (;;) {
      if (!(await this.repository.renewLease(claim))) return // lease reclaimed elsewhere — stop safely
      if (claim.deadlineAt !== null && claim.deadlineAt <= new Date()) {
        await this.repository.finalizeExpired(this.prisma, claim)
        return
      }
      if (providerCalls >= maxSteps) {
        await this.finalizer.exhausted(claim, providerCalls)
        return
      }

      const messages = reconstructLoopMessages(plan.userMessages, rounds, setup.toolMarker ?? '')
      const startedAt = performance.now()
      let result: AiTextResult
      try {
        result = await this.gateway.generateText({
          modelSlug: plan.modelSlug,
          system: setup.system,
          messages,
          tools: setup.tools,
          recordUsage: false,
        })
      } catch (error) {
        await this.finalizer.gatewayError(claim, error)
        return
      }
      providerCalls += 1
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

      await this.finalizer.recordProviderCall(claim, plan, result, durationMs)
      const dispatched = await this.dispatcher.dispatch(decision.tool, decision.call, ctx)
      if (dispatched.status === 'failed') {
        await this.finalizer.dispatchFailed(claim, dispatched.errorCode, providerCalls)
        return
      }
      rounds.push({
        toolCallId: dispatched.toolCallId,
        toolId: decision.tool.toolId,
        // The dispatcher's VALIDATED args (== persisted argsSnapshot) so this uninterrupted round is
        // byte-identical to the same round reconstructed on a crash-resumed attempt (finding A2-1).
        input: dispatched.input,
        output: dispatched.output,
      })
    }
  }

  /**
   * Resolve the per-run step invariants once: the allowlisted tools offered to the model, and — when
   * tools apply OR prior tool rounds must be replayed — a distinct tool-result boundary marker (Arc D
   * reuse) + the augmented trusted instruction. Offering no current tools (empty allowlist) still keeps
   * the boundary if `hasPriorRounds`, so a resumed transcript never wraps a tool result under an empty
   * marker (finding A2-2). No tools and no prior rounds ⇒ the Arc C single-call text path.
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

  /** Classify a provider step's tool calls (≤1 SAFE allowed call — invariant 5). */
  private classify(toolCalls: AiToolCall[], allowlist: string[]): StepDecision {
    if (toolCalls.length === 0) return { kind: 'final' }
    if (toolCalls.length > 1)
      return { kind: 'fail', reason: AiRunTerminalReason.TOO_MANY_TOOL_CALLS }
    const call = toolCalls[0]!
    const tool = this.registry.get(call.toolName)
    if (tool === undefined || !allowlist.includes(tool.toolId)) {
      return { kind: 'fail', reason: AiRunTerminalReason.TOOL_NOT_ALLOWED }
    }
    // Approval-gated tools cannot execute in E.4b; E.5 replaces this with the durable WAITING_APPROVAL park.
    if (this.registry.requiresApproval(tool)) {
      return { kind: 'fail', reason: AiRunTerminalReason.TOOL_APPROVAL_REQUIRED }
    }
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
