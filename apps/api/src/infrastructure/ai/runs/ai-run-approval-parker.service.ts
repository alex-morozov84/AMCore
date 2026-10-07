import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { AiTextResult } from '../gateway/ai-gateway.types'
import type { AiTool } from '../tools/ai-tool.types'

import { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'
import { providerCallStep, writeRunSteps, writeUsageLedger } from './ai-run-loop-persistence'
import type { RunPlan } from './ai-run-plan'
import { applyStop } from './ai-run-transitions.service'
import { findByOrigin, providerCallCount } from './ai-tool-invocation.store'

import { AuditLogService } from '@/core/audit'
import { EnvService } from '@/env/env.service'
import {
  AiApprovalKind,
  AiApprovalState,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client'
import { type AiMetricsToolRiskClass, MetricsService } from '@/infrastructure/observability'

/** What parking resolved to: parked behind an approval, run terminalized (stop cause), or nothing written. */
export type ParkOutcome = 'parked' | 'terminal' | 'exit'

/**
 * Parks a claimed run for human approval (Track C — ADR-054, Arc E.5, worker role only) when the loop
 * accepts an allowed **non-SAFE** tool call. In ONE guarded transaction it records the provider call that
 * requested the tool (`PROVIDER_CALL` step + per-call ledger — the call happened), creates the
 * `AiApproval(PENDING)` + `AiToolInvocation(AWAITING_APPROVAL, originCall)` gate, parks the run
 * `RUNNING → WAITING_APPROVAL` (releasing the lease) and writes the mandatory content-free
 * `ai.approval.requested` audit **in the same tx** (security evidence, not telemetry). A visible stop cause
 * (a user cancel, a takeover, the deadline) refuses the park — the provider call is still recorded, the run
 * terminalizes, and NO pending approval is left behind. A repeated request for the same `originCall` is a
 * no-op (one requested action = one gate). The tool is NOT executed — Arc E.5's decision endpoint re-queues
 * the run and the resumed worker executes it only after an `APPROVED` decision.
 */
@Injectable()
export class AiRunApprovalParker {
  constructor(
    private readonly guard: AiRunGuard,
    private readonly repository: AiRunRepository,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunApprovalParker.name)
  }

  /**
   * Park the run behind a PENDING approval for one non-SAFE tool call (validated `args`), whose provider
   * call has the 1-based `ordinal`. No loop-steps metric here — the park is not a terminal outcome; the
   * resumed attempt records it on completion.
   */
  async park(
    claim: ClaimedRun,
    plan: RunPlan,
    result: AiTextResult,
    durationMs: number,
    ordinal: number,
    tool: AiTool,
    args: unknown
  ): Promise<ParkOutcome> {
    const expiresAt = this.approvalExpiry(claim)
    const outcome = await this.guard.record(claim, async (tx, ctx): Promise<ParkOutcome> => {
      if ((await findByOrigin(tx, claim.id, ordinal)) !== null) return 'exit'
      if ((await providerCallCount(tx, claim.id)) >= ordinal) return 'exit'
      await writeRunSteps(tx, claim.id, [providerCallStep(result, durationMs)])
      await writeUsageLedger(tx, claim, plan.attribution, plan.modelSlug, result)
      if (ctx.stop) {
        await applyStop(tx, this.repository, claim, ctx.stop)
        return 'terminal'
      }
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
          idempotency: tool.idempotency,
          originCall: ordinal,
          approvalId: approval.id,
          argsSnapshot: args as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
      if (!(await this.repository.parkForApproval(tx, claim))) throw new RunLeaseLostError()
      await this.recordRequested(tx, claim, plan, tool, approval.id, invocation.id)
      return 'parked'
    })

    if (outcome.kind !== 'ok') {
      // Lease lost / shutdown: nothing was written; recovery re-runs the step and re-parks.
      this.logger.warn(
        { event: 'ai.run.park_not_committed', runId: claim.id, kind: outcome.kind },
        'AI run approval park not committed (lease lost or shutdown); nothing was written'
      )
      return 'exit'
    }
    if (outcome.value === 'parked') this.metrics.incAiApproval('tool_invocation', 'pending')
    return outcome.value
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
