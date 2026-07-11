import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import {
  AiRunStepType,
  AiToolInvocationStatus,
  AiToolRiskClass,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiToolCall } from '../gateway/ai-gateway.types'
import {
  AiToolErrorCode,
  type AiToolErrorCodeValue,
  toolIdempotencyKey,
} from '../tools/ai-tool.constants'
import type { AiTool, AiToolContext } from '../tools/ai-tool.types'

import type { ClaimedRun } from './ai-run-dispatch.types'

import { AuditLogService } from '@/core/audit'
import { EnvService } from '@/env/env.service'
import { type AiMetricsToolRiskClass, MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/**
 * Defensive cap on the tool output stored in `resultSummary` + fed back to the model. This row is
 * **not** content-free: `resultSummary.output` carries bounded, UNTRUSTED tool output for transcript
 * reconstruction (never used as audit/metric metadata, which stay content-free).
 */
const AI_TOOL_OUTPUT_MAX_CHARS = 8000

/** Run/owner context for one tool dispatch (the loop resolves owner/org once per run). */
export interface ToolDispatchContext {
  claim: ClaimedRun
  ownerUserId: string
  organizationId: string | null
}

/** Outcome of one dispatched tool call: the SUCCEEDED output to feed back, or a bounded failure. */
export type ToolDispatchResult =
  | {
      status: 'succeeded'
      invocationId: string
      toolCallId: string
      /** The VALIDATED args (`parsed.data`, == the persisted `argsSnapshot`) — the loop echoes these
       * back as the assistant tool-call turn so an uninterrupted transcript is byte-identical to a
       * crash-resumed one reconstructed from `argsSnapshot` (schemas with defaults/transforms/strip). */
      input: unknown
      output: string
    }
  | { status: 'failed'; errorCode: AiToolErrorCodeValue }

/**
 * Executes a single SAFE tool call host-side (Track C — ADR-054, Arc E, worker role only). It never
 * holds a DB transaction over the external tool call (Agent 2 constraint 4): tx1 persists the
 * `AiToolInvocation` as `EXECUTING`, the tool runs OUTSIDE any tx under a timeout, then tx2 finalizes
 * `SUCCEEDED`/`FAILED` together with the ordering `TOOL_INVOCATION` step (bounded `{ invocationId,
 * toolCallId }`) so crash-resume reconstruction can order by step number. Args are Zod-validated
 * before execution; output is bounded; audit + metrics are content-free and best-effort.
 */
@Injectable()
export class AiToolDispatcher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditLogService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiToolDispatcher.name)
  }

  async dispatch(
    tool: AiTool,
    toolCall: AiToolCall,
    ctx: ToolDispatchContext
  ): Promise<ToolDispatchResult> {
    // Defensive last gate before host-side execution: the resolved tool MUST match the model-
    // requested name AND be SAFE. This never fires on correct wiring, but it stops an upstream bug
    // (E.4b) from executing a mismatched tool or an approval-gated one before Arc E.5's park exists.
    if (tool.toolId !== toolCall.toolName || tool.riskClass !== AiToolRiskClass.SAFE) {
      await this.persistFailed(tool, ctx, null, AiToolErrorCode.TOOL_NOT_ALLOWED)
      return { status: 'failed', errorCode: AiToolErrorCode.TOOL_NOT_ALLOWED }
    }

    const parsed = tool.parameters.safeParse(toolCall.input)
    if (!parsed.success) {
      await this.persistFailed(tool, ctx, null, AiToolErrorCode.TOOL_ARGS_INVALID)
      return { status: 'failed', errorCode: AiToolErrorCode.TOOL_ARGS_INVALID }
    }

    const invocation = await this.prisma.aiToolInvocation.create({
      data: {
        runId: ctx.claim.id,
        toolId: tool.toolId,
        status: AiToolInvocationStatus.EXECUTING,
        riskClass: tool.riskClass,
        argsSnapshot: parsed.data as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
      select: { id: true },
    })

    const startedAt = performance.now()
    let output: string
    try {
      output = await this.execute(tool, parsed.data, invocation.id, ctx)
    } catch (error) {
      await this.finalizeFailed(invocation.id, tool, ctx, startedAt, error)
      return { status: 'failed', errorCode: AiToolErrorCode.TOOL_EXECUTION_FAILED }
    }

    const boundedOutput = output.slice(0, AI_TOOL_OUTPUT_MAX_CHARS)
    const durationMs = Math.round(performance.now() - startedAt)
    await this.prisma.$transaction(async (tx) => {
      await tx.aiToolInvocation.update({
        where: { id: invocation.id },
        data: {
          status: AiToolInvocationStatus.SUCCEEDED,
          resultSummary: { output: boundedOutput } satisfies Prisma.InputJsonValue,
          finishedAt: new Date(),
          durationMs,
        },
      })
      const stepNumber = await nextStepNumber(tx, ctx.claim.id)
      await tx.aiRunStep.create({
        data: {
          runId: ctx.claim.id,
          stepNumber,
          type: AiRunStepType.TOOL_INVOCATION,
          detail: {
            invocationId: invocation.id,
            toolCallId: toolCall.toolCallId,
          } satisfies Prisma.InputJsonValue,
          durationMs,
          finishedAt: new Date(),
        },
      })
    })

    this.metrics.incAiToolInvocation(tool.toolId, riskLabel(tool), 'succeeded')
    await this.recordAudit(tool, ctx, invocation.id, 'ai.tool.invoked', { outcome: 'succeeded' })
    return {
      status: 'succeeded',
      invocationId: invocation.id,
      toolCallId: toolCall.toolCallId,
      input: parsed.data,
      output: boundedOutput,
    }
  }

  /** Run the tool outside any transaction, bounded by `AI_TOOL_EXECUTION_TIMEOUT_MS` (raced). */
  private async execute(
    tool: AiTool,
    args: unknown,
    invocationId: string,
    ctx: ToolDispatchContext
  ): Promise<string> {
    const timeoutMs = this.env.get('AI_TOOL_EXECUTION_TIMEOUT_MS')
    const toolContext: AiToolContext = {
      runId: ctx.claim.id,
      conversationId: ctx.claim.conversationId,
      ownerUserId: ctx.ownerUserId,
      organizationId: ctx.organizationId,
      invocationId,
      idempotencyKey: toolIdempotencyKey(invocationId),
      signal: AbortSignal.timeout(timeoutMs),
    }
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('tool execution timed out')), timeoutMs)
    })
    try {
      const result = await Promise.race([tool.execute(args, toolContext), timeout])
      return result.output
    } finally {
      clearTimeout(timer)
    }
  }

  /** tx2 on a failed execution: mark the EXECUTING invocation FAILED, count + audit (best-effort). */
  private async finalizeFailed(
    invocationId: string,
    tool: AiTool,
    ctx: ToolDispatchContext,
    startedAt: number,
    error: unknown
  ): Promise<void> {
    this.logger.warn(
      {
        event: 'ai.tool.execution_failed',
        runId: ctx.claim.id,
        toolId: tool.toolId,
        err: error instanceof Error ? error.name : 'unknown',
      },
      'AI tool execution failed'
    )
    await this.prisma.aiToolInvocation.update({
      where: { id: invocationId },
      data: {
        status: AiToolInvocationStatus.FAILED,
        errorCode: AiToolErrorCode.TOOL_EXECUTION_FAILED,
        finishedAt: new Date(),
        durationMs: Math.round(performance.now() - startedAt),
      },
    })
    this.metrics.incAiToolInvocation(tool.toolId, riskLabel(tool), 'failed')
    await this.recordAudit(tool, ctx, invocationId, 'ai.tool.execution_failed', {
      reasonCode: AiToolErrorCode.TOOL_EXECUTION_FAILED,
    })
  }

  /** Persist a terminal FAILED invocation for a pre-execution rejection (e.g. invalid args). */
  private async persistFailed(
    tool: AiTool,
    ctx: ToolDispatchContext,
    argsSnapshot: Prisma.InputJsonValue | null,
    errorCode: AiToolErrorCodeValue
  ): Promise<string> {
    const invocation = await this.prisma.aiToolInvocation.create({
      data: {
        runId: ctx.claim.id,
        toolId: tool.toolId,
        status: AiToolInvocationStatus.FAILED,
        riskClass: tool.riskClass,
        argsSnapshot: argsSnapshot ?? undefined,
        errorCode,
        finishedAt: new Date(),
      },
      select: { id: true },
    })
    this.metrics.incAiToolInvocation(tool.toolId, riskLabel(tool), 'failed')
    await this.recordAudit(tool, ctx, invocation.id, 'ai.tool.execution_failed', {
      reasonCode: errorCode,
    })
    return invocation.id
  }

  /** Content-free tool audit event (best-effort — a CLS-less worker or audit fault never breaks a run). */
  private async recordAudit(
    tool: AiTool,
    ctx: ToolDispatchContext,
    invocationId: string,
    action: 'ai.tool.invoked' | 'ai.tool.execution_failed',
    extra: Record<string, string>
  ): Promise<void> {
    try {
      await this.audit.record({
        action,
        actorType: AuditActorType.SYSTEM,
        targetType: AuditTargetType.AI_TOOL_INVOCATION,
        targetId: invocationId,
        organizationId: ctx.organizationId,
        metadata: {
          toolId: tool.toolId,
          riskClass: riskLabel(tool),
          invocationId,
          runId: ctx.claim.id,
          ...extra,
        },
      })
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
}

/** Lowercase wire risk-class for the metric label + audit metadata. */
function riskLabel(tool: AiTool): AiMetricsToolRiskClass {
  return tool.riskClass.toLowerCase() as AiMetricsToolRiskClass
}

async function nextStepNumber(tx: Prisma.TransactionClient, runId: string): Promise<number> {
  const { _max } = await tx.aiRunStep.aggregate({ where: { runId }, _max: { stepNumber: true } })
  return (_max.stepNumber ?? 0) + 1
}
