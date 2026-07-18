import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type {
  AiApprovalListQuery,
  AiApprovalListResponse,
  AiApprovalResponse,
  DecideAiApprovalInput,
} from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../../common/exceptions'
import { AI_APPROVAL_LIST_LIMIT, AI_RUN_WAKE_JOB_OPTIONS } from '../ai-run.constants'
import type { AiRunWakeJob } from '../runs/ai-run-producer.service'

import { toAiApprovalResponse } from './ai-approval.mapper'
import { ApprovalRaceError, expireApproval } from './ai-approval-expiry'

import { AuditLogService } from '@/core/audit'
import {
  AiApprovalState,
  AiRunStatus,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'
import { PrismaService } from '@/prisma'

/** Row of the `FOR UPDATE OF a, r` lock join (enum columns cast to text for JS comparison). */
interface ApprovalLockRow {
  id: string
  state: string
  expiresAt: Date | null
  runId: string
  runStatus: string
  deadlineAt: Date | null
  attemptCount: number
  ownerUserId: string
}

/** The committed outcome of a decision transaction, mapped to an HTTP result post-commit. */
type DecisionOutcome =
  | { kind: 'not_found' }
  | { kind: 'conflict'; message: string }
  | { kind: 'idempotent'; response: AiApprovalResponse }
  | { kind: 'expired' }
  | { kind: 'decided'; decision: 'approve' | 'reject'; runId: string; response: AiApprovalResponse }

/**
 * Owner-scoped human-in-the-loop approval surface (Track C — ADR-054, Arc E.5, web role). Lists a
 * caller's approvals and records approve/reject decisions. A decision runs under a `FOR UPDATE` lock on
 * the approval **and** its run so the freshness gate + multi-CAS is atomic: a stale approval is
 * inline-expired (never re-queued), a duplicate decision is idempotent, a conflicting one is 409, and a
 * fresh decision flips the approval + invocation and re-queues the run (decrementing `attemptCount` so
 * the resume does not consume a provider-retry attempt). Every `ai.approval.*` event is written in the
 * same transaction (security evidence); the wake + metric are post-commit. No provider or tool I/O.
 */
@Injectable()
export class AiApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiApprovalService.name)
  }

  /** The caller's approvals (newest first, bounded), optionally filtered by state. */
  async list(userId: string, query: AiApprovalListQuery): Promise<AiApprovalListResponse> {
    const approvals = await this.prisma.aiApproval.findMany({
      where: {
        run: { conversation: { ownerUserId: userId } },
        ...(query.status ? { state: query.status.toUpperCase() as AiApprovalState } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { toolInvocations: { select: { toolId: true, riskClass: true }, take: 1 } },
      take: AI_APPROVAL_LIST_LIMIT,
    })
    return { data: approvals.map(toAiApprovalResponse) }
  }

  /** Record an owner decision; re-queues the run on success, or 404/409 on a stale/raced/foreign one. */
  async decide(
    userId: string,
    approvalId: string,
    input: DecideAiApprovalInput
  ): Promise<AiApprovalResponse> {
    let outcome: DecisionOutcome
    try {
      outcome = await this.prisma.$transaction((tx) => this.decideTx(tx, userId, approvalId, input))
    } catch (error) {
      // A multi-CAS mismatch rolled the whole decision back (non-effect) → surface it as a conflict.
      if (error instanceof ApprovalRaceError) {
        throw new ConflictException('This approval could not be decided; its state changed.')
      }
      throw error
    }
    switch (outcome.kind) {
      case 'not_found':
        throw new NotFoundException('Ai approval', approvalId)
      case 'conflict':
        throw new ConflictException(outcome.message)
      case 'expired':
        this.metrics.incAiApproval('tool_invocation', 'expired')
        throw new ConflictException('This approval has expired.')
      case 'idempotent':
        return outcome.response
      case 'decided':
        await this.enqueueWake(outcome.runId)
        this.metrics.incAiApproval(
          'tool_invocation',
          outcome.decision === 'approve' ? 'approved' : 'rejected'
        )
        return outcome.response
    }
  }

  /** The locked read + branch (freshness gate → inline-expire / duplicate / conflict / decide). */
  private async decideTx(
    tx: Prisma.TransactionClient,
    userId: string,
    approvalId: string,
    input: DecideAiApprovalInput
  ): Promise<DecisionOutcome> {
    const rows = await tx.$queryRaw<ApprovalLockRow[]>(Prisma.sql`
      SELECT a.id, a.state::text AS state, a."expiresAt", a."runId",
             r.status::text AS "runStatus", r."deadlineAt", r."attemptCount",
             c."ownerUserId"
      FROM "ai"."ai_approvals" a
      JOIN "ai"."ai_runs" r ON r.id = a."runId"
      JOIN "ai"."ai_conversations" c ON c.id = r."conversationId"
      WHERE a.id = ${approvalId}
      FOR UPDATE OF a, r
    `)
    const row = rows[0]
    if (row === undefined || row.ownerUserId !== userId) return { kind: 'not_found' }

    const now = new Date()
    const desired = input.decision === 'approve' ? 'APPROVED' : 'REJECTED'
    if (row.state !== 'PENDING') {
      return row.state === desired
        ? { kind: 'idempotent', response: await this.project(tx, approvalId) }
        : { kind: 'conflict', message: 'This approval has already been decided.' }
    }

    // Freshness gate (A2-R1 #1): a stale approval the cron has not swept yet is inline-expired here and
    // NEVER re-queued. Deadline wins the reason over the approval TTL (both bounded content-free codes).
    const deadlinePassed = row.deadlineAt !== null && row.deadlineAt <= now
    if (deadlinePassed || (row.expiresAt !== null && row.expiresAt <= now)) {
      await expireApproval(tx, this.audit, {
        approvalId: row.id,
        runId: row.runId,
        deadlinePassed,
        now,
      })
      return { kind: 'expired' }
    }
    if (row.runStatus !== AiRunStatus.WAITING_APPROVAL) {
      return { kind: 'conflict', message: 'This run is no longer awaiting approval.' }
    }

    await this.applyDecision(tx, row, input.decision, userId, now)
    return {
      kind: 'decided',
      decision: input.decision,
      runId: row.runId,
      response: await this.project(tx, approvalId),
    }
  }

  /** Flip approval + invocation to the decision and re-queue the run (attemptCount-preserving). */
  private async applyDecision(
    tx: Prisma.TransactionClient,
    row: ApprovalLockRow,
    decision: 'approve' | 'reject',
    userId: string,
    now: Date
  ): Promise<void> {
    const approvalState =
      decision === 'approve' ? AiApprovalState.APPROVED : AiApprovalState.REJECTED
    const invocationState =
      decision === 'approve' ? AiToolInvocationStatus.APPROVED : AiToolInvocationStatus.REJECTED
    const approval = await tx.aiApproval.updateMany({
      where: { id: row.id, state: AiApprovalState.PENDING },
      data: { state: approvalState, decidedById: userId, decidedAt: now },
    })
    // Re-queue; decrement the claim budget ONLY when attemptCount > 0 (A2-R1 #2) so a broken invariant
    // can never mint a negative budget, and the resume claim's +1 nets zero.
    const run = await tx.aiRun.updateMany({
      where: { id: row.runId, status: AiRunStatus.WAITING_APPROVAL },
      data: {
        status: AiRunStatus.QUEUED,
        availableAt: now,
        ...(row.attemptCount > 0 ? { attemptCount: { decrement: 1 } } : {}),
      },
    })
    // The gated invocation is NOT under the row lock, so its flip can race — enforce all three CAS
    // counts (A2-R2 #1): any ≠1 rolls the whole decision back before the audit is written.
    const invocation = await tx.aiToolInvocation.updateMany({
      where: { approvalId: row.id, status: AiToolInvocationStatus.AWAITING_APPROVAL },
      data: { status: invocationState },
    })
    if (approval.count !== 1 || run.count !== 1 || invocation.count !== 1) {
      throw new ApprovalRaceError()
    }
    await this.audit.record(
      {
        action: decision === 'approve' ? 'ai.approval.approved' : 'ai.approval.rejected',
        actorType: AuditActorType.USER,
        actorId: userId,
        targetType: AuditTargetType.AI_APPROVAL,
        targetId: row.id,
        metadata: { approvalId: row.id, runId: row.runId, decision },
      },
      { tx }
    )
  }

  /** Read + project the approval (with its gated tool) to the content-free wire response. */
  private async project(
    tx: Prisma.TransactionClient,
    approvalId: string
  ): Promise<AiApprovalResponse> {
    const approval = await tx.aiApproval.findUniqueOrThrow({
      where: { id: approvalId },
      include: { toolInvocations: { select: { toolId: true, riskClass: true }, take: 1 } },
    })
    return toAiApprovalResponse(approval)
  }

  /** Best-effort post-commit wake — the recovery cron drains the re-queued run regardless. */
  private async enqueueWake(runId: string): Promise<void> {
    try {
      await this.queue.add(
        QueueName.AI_RUNS,
        JobName.AI_RUN_WAKE,
        { runId } satisfies AiRunWakeJob,
        AI_RUN_WAKE_JOB_OPTIONS
      )
    } catch (err) {
      this.logger.warn(
        {
          event: 'ai.approval.wake_enqueue_failed',
          runId,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Failed to enqueue AI run wake after approval decision (recovery cron will claim it)'
      )
    }
  }
}
