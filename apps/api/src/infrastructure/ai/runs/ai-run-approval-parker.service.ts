import { Injectable } from '@nestjs/common'
import {
  AiApprovalKind,
  AiApprovalState,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiTextResult } from '../gateway/ai-gateway.types'
import type { AiTool } from '../tools/ai-tool.types'

import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { providerCallStep, writeRunSteps, writeUsageLedger } from './ai-run-loop-persistence'
import type { RunPlan } from './ai-run-plan'

import { AuditLogService } from '@/core/audit'
import { EnvService } from '@/env/env.service'
import { type AiMetricsToolRiskClass, MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** Thrown inside the park transaction when the CAS finds no row → roll the whole park back. */
class RunLeaseLostError extends Error {}

/**
 * Parks a claimed run for human approval (Track C — ADR-054, Arc E.5, worker role only) when the loop
 * accepts an allowed **non-SAFE** tool call. In ONE transaction it records the provider call that
 * requested the tool (`PROVIDER_CALL` step + per-call ledger — the call happened), creates the
 * `AiApproval(PENDING)` + `AiToolInvocation(AWAITING_APPROVAL)` gate, parks the run
 * `RUNNING → WAITING_APPROVAL` (releasing the lease), and writes the mandatory content-free
 * `ai.approval.requested` audit **in the same tx** (security evidence, not telemetry). A lost lease
 * rolls the entire park back for recovery. The tool is NOT executed — Arc E.5's decision endpoint
 * re-queues the run and the resumed worker executes it only after an `APPROVED` decision.
 */
@Injectable()
export class AiRunApprovalParker {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiRunRepository,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunApprovalParker.name)
  }

  /**
   * Park the run behind a PENDING approval for one non-SAFE tool call (validated `args`). No loop-steps
   * metric here — the park is not a terminal outcome; the resumed attempt records it on completion.
   */
  async park(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number,
    tool: AiTool,
    args: unknown
  ): Promise<boolean> {
    const expiresAt = this.approvalExpiry(claim)
    try {
      await this.prisma.$transaction(async (tx) => {
        await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
        await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
        const approval = await tx.aiApproval.create({
          data: {
            runId: claim.id,
            conversationId: claim.conversationId,
            kind: AiApprovalKind.TOOL_INVOCATION,
            state: AiApprovalState.PENDING,
            expiresAt,
          },
          select: { id: true },
        })
        const invocation = await tx.aiToolInvocation.create({
          data: {
            runId: claim.id,
            toolId: tool.toolId,
            status: AiToolInvocationStatus.AWAITING_APPROVAL,
            riskClass: tool.riskClass,
            approvalId: approval.id,
            argsSnapshot: args as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
        if (!(await this.repository.parkForApproval(tx, claim))) throw new RunLeaseLostError()
        await this.recordRequested(tx, claim, plan, tool, approval.id, invocation.id)
      })
      this.metrics.incAiApproval('tool_invocation', 'pending')
      return true
    } catch (error) {
      if (error instanceof RunLeaseLostError) {
        this.logger.warn(
          { event: 'ai.run.park_lease_lost', runId: claim.id },
          'AI run lease lost while parking for approval; park rolled back'
        )
        return false
      }
      // Provider call happened but the park failed durably — leave RUNNING for recovery (retry re-parks).
      this.logger.error(
        {
          event: 'ai.run.park_failed',
          runId: claim.id,
          error: error instanceof Error ? error.name : 'unknown',
        },
        'AI run approval park transaction failed; left non-terminal for recovery'
      )
      return false
    }
  }

  /** Approval TTL from now, but never later than the run's own deadline (whichever is tighter). */
  private approvalExpiry(claim: ClaimedRun): Date {
    const ttlExpiry = new Date(Date.now() + this.env.get('AI_APPROVAL_TTL_MS'))
    if (claim.deadlineAt !== null && claim.deadlineAt < ttlExpiry) return claim.deadlineAt
    return ttlExpiry
  }

  /** Mandatory, content-free `ai.approval.requested` audit — in the park tx (atomic with the CAS). */
  private async recordRequested(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    plan: RunPlan,
    tool: AiTool,
    approvalId: string,
    invocationId: string
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'ai.approval.requested',
        actorType: AuditActorType.SYSTEM,
        targetType: AuditTargetType.AI_APPROVAL,
        targetId: approvalId,
        organizationId: plan.attribution.organizationId,
        metadata: {
          toolId: tool.toolId,
          riskClass: riskLabel(tool),
          approvalId,
          invocationId,
          runId: claim.id,
        },
      },
      { tx }
    )
  }
}

/** Lowercase wire risk-class for the audit metadata (content-free). */
function riskLabel(tool: AiTool): AiMetricsToolRiskClass {
  return tool.riskClass.toLowerCase() as AiMetricsToolRiskClass
}
