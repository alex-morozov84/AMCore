import { performance } from 'node:perf_hooks'

import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { AiTextResult } from '../gateway/ai-gateway.types'
import {
  AI_TOOL_REJECTION_NOTICE,
  AiToolErrorCode,
  type AiToolErrorCodeValue,
  approvedToolCallId,
  toolIdempotencyKey,
} from '../tools/ai-tool.constants'
import type { AiTool, AiToolContext } from '../tools/ai-tool.types'
import { AiToolNoEffectError } from '../tools/ai-tool-error'

import { AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'
import { providerCallStep, writeRunSteps, writeUsageLedger } from './ai-run-loop-persistence'
import type { RunPlan } from './ai-run-plan'
import { AI_RUN_SHUTDOWN_LATCH } from './ai-run-shutdown'
import { AiRunTransitions, applyStop } from './ai-run-transitions.service'
import {
  applyRejection,
  createRequested,
  findByOrigin,
  type InvocationRow,
  isReadOnly,
  providerCallCount,
  recordFailure,
  recordSuccess,
  sameAction,
  startExecution,
} from './ai-tool-invocation.store'

import { canonicalJsonEqual } from '@/common/utils/canonical-json'
import { AuditLogService } from '@/core/audit'
import { EnvService } from '@/env/env.service'
import { AiToolInvocationStatus, AuditActorType, AuditTargetType } from '@/generated/prisma/client'
import { type AiMetricsToolRiskClass, MetricsService } from '@/infrastructure/observability'
import type { AttemptRuntime, ShutdownLatch } from '@/infrastructure/worker-lifecycle'

/**
 * Defensive cap on the tool output stored in `resultSummary` + fed back to the model. This row is
 * **not** content-free: `resultSummary.output` carries bounded, UNTRUSTED tool output for transcript
 * reconstruction (never used as audit/metric metadata, which stay content-free).
 */
const AI_TOOL_OUTPUT_MAX_CHARS = 8000

/** Run/owner context for one tool action. The runtime tracks the physical call's settlement. */
export interface ToolRunContext {
  claim: ClaimedRun
  ownerUserId: string
  organizationId: string | null
  runtime: AttemptRuntime
}

/** The outcome of driving one action. Anything but `succeeded` means the loop must stop. */
export type ActionStep =
  /** The result was applied to the transcript exactly once; the loop continues with this round. */
  | { status: 'succeeded'; toolCallId: string; input: unknown; output: string }
  /** The run was terminalized (tool failure, uncertain effect, stop cause, conflict). */
  | { status: 'terminal' }
  /** Nothing more to do here: lease lost, shutdown, or a competing continuation owns the action. */
  | { status: 'exit' }

/** The result of recording the durable intent of a requested action. */
export type IntentResult =
  { kind: 'ready'; action: InvocationRow } | { kind: 'terminal' } | { kind: 'exit' }

/** A local timeout bound; never surfaced to the model. */
class ToolTimeoutError extends Error {
  constructor() {
    super('tool execution timed out')
    this.name = 'ToolTimeoutError'
  }
}

type ToolRun =
  | { ok: true; output: string; durationMs: number }
  | { ok: false; error: unknown; durationMs: number }

/**
 * Drives one durable tool action (Track C — ADR-054, Arc E, worker role only; E12 minimal contract).
 *
 * - **Intent first:** the provider call that requested the tool, its usage ledger row and the
 *   `AiToolInvocation` (frozen normalized input, idempotency class, `originCall` identity) commit in ONE
 *   guarded transaction BEFORE any effect. A repeat of the same requested action reuses the original row.
 * - **One-shot start:** `REQUESTED|APPROVED → EXECUTING` stamps the lease epoch inside an admission
 *   guard (cancel/deadline/takeover refuse the start); the tool then runs OUTSIDE any transaction under
 *   its timeout; the result commit is a CAS on that epoch, applied to the transcript exactly once.
 * - **Honest outcomes:** an explicit no-effect error or any read-only failure is `FAILED`; a timeout or
 *   unclassified failure of a side-effecting tool is `OUTCOME_UNKNOWN` — the run stops uncertain, and
 *   nothing is replayed or re-requested. A stop cause observed while the tool ran never erases its known
 *   outcome: the result is recorded, then the run terminalizes and starts no next action.
 */
@Injectable()
export class AiToolActionService {
  constructor(
    private readonly guard: AiRunGuard,
    private readonly repository: AiRunRepository,
    private readonly transitions: AiRunTransitions,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditLogService,
    @Inject(AI_RUN_SHUTDOWN_LATCH) private readonly latch: ShutdownLatch,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiToolActionService.name)
  }

  /**
   * Record, atomically and before any effect, the provider call that requested `tool` with the validated
   * `args`. `ordinal` is the 1-based provider-call ordinal the caller expects this call to take. If that
   * ordinal is already taken the original action is reused (same normalized input) or the run fails closed
   * (different input); no second row, key or physical call can exist for one requested action.
   */
  async requestAction(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number,
    ordinal: number,
    tool: AiTool,
    args: unknown
  ): Promise<IntentResult> {
    const outcome = await this.guard.record(claim, async (tx, ctx): Promise<IntentResult> => {
      const existing = await findByOrigin(tx, claim.id, ordinal)
      if (existing !== null) {
        if (sameAction(existing, tool.toolId, args)) return { kind: 'ready', action: existing }
        await this.failClosed(tx, claim, AiRunTerminalReason.ACTION_INPUT_CONFLICT)
        return { kind: 'terminal' }
      }
      if ((await providerCallCount(tx, claim.id)) >= ordinal) return { kind: 'exit' }
      await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
      await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
      if (ctx.stop) {
        await applyStop(tx, this.repository, claim, ctx.stop)
        return { kind: 'terminal' }
      }
      return { kind: 'ready', action: await createRequested(tx, claim, tool, ordinal, args) }
    })
    return outcome.kind === 'ok' ? outcome.value : { kind: 'exit' }
  }

  /**
   * Execute a durable action (`REQUESTED`/`APPROVED`/stranded `EXECUTING`). `args` are the in-memory
   * normalized arguments of the live path; omit them on recovery — the stored snapshot is then re-parsed
   * and must parse to itself under the current tool schema, else the action fails closed
   * (`tool_schema_incompatible`) and is never executed under its old identity with changed data.
   */
  async execute(
    ctx: ToolRunContext,
    action: InvocationRow,
    tool: AiTool,
    toolCallId: string,
    args?: unknown
  ): Promise<ActionStep> {
    const { claim } = ctx
    let frozenArgs = args
    if (frozenArgs === undefined) {
      const parsed = tool.parameters.safeParse(action.argsSnapshot)
      const mayCheck = action.status !== AiToolInvocationStatus.EXECUTING || isReadOnly(action)
      if (mayCheck) {
        if (!parsed.success || !canonicalJsonEqual(parsed.data, action.argsSnapshot)) {
          return this.rejectIncompatible(claim, action)
        }
        frozenArgs = parsed.data
      }
    }

    const start = await this.guard.admit(
      claim,
      (tx) => startExecution(tx, this.repository, claim, action),
      { markIoStarted: true }
    )
    if (start.kind === 'stopped') {
      return (await this.transitions.stop(claim, start.cause)) === 'applied'
        ? { status: 'terminal' }
        : { status: 'exit' }
    }
    if (start.kind !== 'ok') return { status: 'exit' }
    if (start.value === 'unknown') {
      this.metrics.incAiToolInvocation(action.toolId, riskOf(action), 'effect_unknown')
      return { status: 'terminal' }
    }
    if (start.value !== 'started' && start.value !== 'adopted') return { status: 'exit' }

    const run = await this.runTool(ctx, action, tool, frozenArgs, toolCallId)
    return this.record(ctx, action, tool, toolCallId, frozenArgs, run)
  }

  /**
   * Apply an owner REJECTION on resume exactly once: `appliedAt` CAS + ordering step in one admitted
   * transaction (a stop cause refuses it and terminalizes). No tool runs; the decision audit was written
   * by the web decision.
   */
  async applyRejected(ctx: ToolRunContext, action: InvocationRow): Promise<ActionStep> {
    const toolCallId = approvedToolCallId(action.id)
    const outcome = await this.guard.admit(ctx.claim, (tx) =>
      applyRejection(tx, ctx.claim, action, toolCallId)
    )
    if (outcome.kind === 'stopped') {
      return (await this.transitions.stop(ctx.claim, outcome.cause)) === 'applied'
        ? { status: 'terminal' }
        : { status: 'exit' }
    }
    if (outcome.kind !== 'ok' || !outcome.value) return { status: 'exit' }
    this.metrics.incAiToolInvocation(action.toolId, riskOf(action), 'rejected')
    return {
      status: 'succeeded',
      toolCallId,
      input: action.argsSnapshot,
      output: AI_TOOL_REJECTION_NOTICE,
    }
  }

  /** Terminalize a run whose action cannot proceed (frozen input incompatible with the current schema). */
  private async rejectIncompatible(claim: ClaimedRun, action: InvocationRow): Promise<ActionStep> {
    const outcome = await this.guard.record(claim, async (tx, g) => {
      await tx.aiToolInvocation.updateMany({
        where: {
          id: action.id,
          status: {
            in: [
              AiToolInvocationStatus.REQUESTED,
              AiToolInvocationStatus.APPROVED,
              AiToolInvocationStatus.EXECUTING,
            ],
          },
        },
        data: {
          status: AiToolInvocationStatus.FAILED,
          errorCode: AiToolErrorCode.TOOL_SCHEMA_INCOMPATIBLE,
          finishedAt: new Date(),
        },
      })
      if (g.stop) return applyStop(tx, this.repository, claim, g.stop)
      await this.failClosed(tx, claim, AiRunTerminalReason.TOOL_SCHEMA_INCOMPATIBLE)
    })
    return outcome.kind === 'ok' ? { status: 'terminal' } : { status: 'exit' }
  }

  /** Run the tool outside any transaction, bounded by `AI_TOOL_EXECUTION_TIMEOUT_MS` and the run lifetime. */
  private async runTool(
    ctx: ToolRunContext,
    action: InvocationRow,
    tool: AiTool,
    args: unknown,
    toolCallId: string
  ): Promise<ToolRun> {
    void toolCallId
    const timeoutMs = this.env.get('AI_TOOL_EXECUTION_TIMEOUT_MS')
    const signals = [AbortSignal.timeout(timeoutMs), ctx.runtime.attempt.signal]
    if (ctx.claim.deadlineAt !== null) {
      signals.push(AbortSignal.timeout(Math.max(0, ctx.claim.deadlineAt.getTime() - Date.now())))
    }
    const toolContext: AiToolContext = {
      runId: ctx.claim.id,
      conversationId: ctx.claim.conversationId,
      ownerUserId: ctx.ownerUserId,
      organizationId: ctx.organizationId,
      invocationId: action.id,
      idempotencyKey: toolIdempotencyKey(action.id),
      signal: AbortSignal.any(signals),
    }
    const startedAt = performance.now()
    const execution = (async () => (await tool.execute(args, toolContext)).output)()
    // The slot stays reserved until the physical call settles, even when the timeout wins the race.
    ctx.runtime.onTransportStarted(execution)
    let timer: NodeJS.Timeout | undefined
    const bound = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs)
    })
    try {
      const output = (await Promise.race([execution, bound])).slice(0, AI_TOOL_OUTPUT_MAX_CHARS)
      return { ok: true, output, durationMs: Math.round(performance.now() - startedAt) }
    } catch (error) {
      return { ok: false, error, durationMs: Math.round(performance.now() - startedAt) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Commit the observed outcome under the epoch that started it (record mode), terminalizing as needed. */
  private async record(
    ctx: ToolRunContext,
    action: InvocationRow,
    tool: AiTool,
    toolCallId: string,
    args: unknown,
    run: ToolRun
  ): Promise<ActionStep> {
    const { claim } = ctx
    const failure = run.ok ? null : classifyFailure(action, run.error)
    const outcome = await this.guard.record(claim, async (tx, g): Promise<ActionStep> => {
      if (run.ok) {
        await recordSuccess(
          tx,
          claim,
          action,
          { output: run.output, durationMs: run.durationMs, toolCallId },
          g.stop === null
        )
        if (g.stop === null) {
          return { status: 'succeeded', toolCallId, input: args, output: run.output }
        }
        await applyStop(tx, this.repository, claim, g.stop)
        return { status: 'terminal' }
      }
      await recordFailure(tx, claim, action, {
        status: failure!.status,
        errorCode: failure!.errorCode,
        durationMs: run.durationMs,
      })
      if (g.stop) {
        await applyStop(tx, this.repository, claim, g.stop)
      } else {
        await this.failTerminal(tx, claim, failure!.reason)
      }
      return { status: 'terminal' }
    })
    if (outcome.kind !== 'ok') {
      this.logger.warn(
        { event: 'ai.tool.result_not_recorded', runId: claim.id, kind: outcome.kind },
        'AI tool result could not be recorded (stale holder or shutdown); recovery owns the action'
      )
      return { status: 'exit' }
    }
    await this.observe(ctx, action, tool, run.ok ? null : failure!)
    return outcome.value
  }

  /** Content-free metric + best-effort audit after the outcome committed. */
  private async observe(
    ctx: ToolRunContext,
    action: InvocationRow,
    tool: AiTool,
    failure: ClassifiedFailure | null
  ): Promise<void> {
    const metric =
      failure === null
        ? 'succeeded'
        : failure.status === AiToolInvocationStatus.OUTCOME_UNKNOWN
          ? 'effect_unknown'
          : 'failed'
    this.metrics.incAiToolInvocation(tool.toolId, riskOf(action), metric)
    try {
      // Through the latch: after the shutdown seal no late audit write starts.
      await this.latch.run(() =>
        this.audit.record({
          action: failure === null ? 'ai.tool.invoked' : 'ai.tool.execution_failed',
          actorType: AuditActorType.SYSTEM,
          targetType: AuditTargetType.AI_TOOL_INVOCATION,
          targetId: action.id,
          organizationId: ctx.organizationId,
          metadata: {
            toolId: tool.toolId,
            riskClass: riskOf(action),
            invocationId: action.id,
            runId: ctx.claim.id,
            ...(failure === null ? { outcome: 'succeeded' } : { reasonCode: failure.errorCode }),
          },
        })
      )
    } catch (error) {
      this.logger.warn(
        {
          event: 'ai.tool.audit_failed',
          runId: ctx.claim.id,
          err: error instanceof Error ? error.name : 'unknown',
        },
        'AI tool audit write failed (best-effort)'
      )
    }
  }

  private async failTerminal(
    tx: Parameters<Parameters<AiRunGuard['record']>[1]>[0],
    claim: ClaimedRun,
    reason: string
  ): Promise<void> {
    const won = await this.repository.finalizeFailed(tx, claim, 'tool_loop_failed', reason)
    if (!won) throw new RunLeaseLostError()
  }

  private failClosed(
    tx: Parameters<Parameters<AiRunGuard['record']>[1]>[0],
    claim: ClaimedRun,
    reason: string
  ): Promise<void> {
    return this.failTerminal(tx, claim, reason)
  }
}

interface ClassifiedFailure {
  status: typeof AiToolInvocationStatus.FAILED | typeof AiToolInvocationStatus.OUTCOME_UNKNOWN
  errorCode: AiToolErrorCodeValue
  /** The run's terminal reason when no stop cause overrides it. */
  reason: string
}

/**
 * Classify a tool failure conservatively. Only an explicit no-effect error proves nothing happened; a
 * read-only tool has no effect to be unsure about; everything else (a timeout, an unclassified throw —
 * which can follow a remote success) leaves a side-effecting tool's effect UNKNOWN.
 */
function classifyFailure(action: InvocationRow, error: unknown): ClassifiedFailure {
  if (error instanceof AiToolNoEffectError) {
    return {
      status: AiToolInvocationStatus.FAILED,
      errorCode:
        error.outcome === 'rejected_no_effect'
          ? AiToolErrorCode.TOOL_REJECTED_NO_EFFECT
          : AiToolErrorCode.TOOL_RETRYABLE_NO_EFFECT,
      reason: AiRunTerminalReason.TOOL_EXECUTION_FAILED,
    }
  }
  if (isReadOnly(action)) {
    return {
      status: AiToolInvocationStatus.FAILED,
      errorCode: AiToolErrorCode.TOOL_EXECUTION_FAILED,
      reason: AiRunTerminalReason.TOOL_EXECUTION_FAILED,
    }
  }
  return {
    status: AiToolInvocationStatus.OUTCOME_UNKNOWN,
    errorCode: AiToolErrorCode.TOOL_EFFECT_UNKNOWN,
    reason: AiRunTerminalReason.TOOL_EFFECT_UNKNOWN,
  }
}

function riskOf(action: InvocationRow): AiMetricsToolRiskClass {
  return action.riskClass.toLowerCase() as AiMetricsToolRiskClass
}
