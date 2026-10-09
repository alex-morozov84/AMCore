import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type {
  AiApprovalListQuery,
  AiApprovalListResponse,
  AiApprovalResponse,
  DecideAiApprovalInput,
} from '@amcore/shared'
import { coerceSupportedLocale, decideAiApprovalSchema } from '@amcore/shared'

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../../common/exceptions'
import { AI_APPROVAL_LIST_LIMIT, AI_RUN_WAKE_JOB_OPTIONS } from '../ai-run.constants'
import { lockRun, runIdOfApproval } from '../ai-run-locks'
import type { AiRunWakeJob } from '../runs/ai-run-producer.service'

import {
  type AiApprovalWithTool,
  APPROVAL_TOOL_SELECT,
  toAiApprovalResponse,
} from './ai-approval.mapper'
import { ApprovalRaceError, expireApproval } from './ai-approval-expiry'

import { canonicalJsonEqual } from '@/common/utils/canonical-json'
import { AuditLogService } from '@/core/audit'
import {
  AiApprovalState,
  AiRunStatus,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client'
import { AiToolContractRegistry } from '@/infrastructure/ai/tools/ai-tool-contract.registry'
import { readToolIntent } from '@/infrastructure/ai/tools/ai-tool-intent'
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
  ownerUserId: string
  intentHash: string | null
  conversationId: string
  organizationId: string | null
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
 * fresh decision flips the approval + invocation and re-queues the run (a resume is a new lease epoch
 * and spends no retry budget). Every `ai.approval.*` event is written in the
 * same transaction (security evidence); the wake + metric are post-commit. No provider or tool I/O.
 */
@Injectable()
export class AiApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger,
    private readonly contracts: AiToolContractRegistry
  ) {
    this.logger.setContext(AiApprovalService.name)
  }

  /** The caller's approvals (newest first, bounded), optionally filtered by state. */
  async list(userId: string, query: AiApprovalListQuery): Promise<AiApprovalListResponse> {
    return this.prisma.$transaction(async (tx) => {
      const approvals = await tx.aiApproval.findMany({
        where: {
          run: { conversation: { ownerUserId: userId } },
          ...(query.status ? { state: query.status.toUpperCase() as AiApprovalState } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: { toolInvocations: { select: APPROVAL_TOOL_SELECT, take: 1 } },
        take: AI_APPROVAL_LIST_LIMIT,
      })
      return {
        data: await Promise.all(approvals.map((approval) => this.disclose(tx, approval, userId))),
      }
    })
  }

  /** Record an owner decision; re-queues the run on success, or 404/409 on a stale/raced/foreign one. */
  async decide(
    userId: string,
    approvalId: string,
    input: DecideAiApprovalInput
  ): Promise<AiApprovalResponse> {
    input = decideAiApprovalSchema.parse(input)
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
    // Lock order: run BEFORE approval (see `ai-run-locks`), so decide never lock-cycles with cancel,
    // the expiry sweep, a takeover or the worker's ownership guard.
    const lockedRunId = await runIdOfApproval(tx, approvalId)
    if (lockedRunId === null || (await lockRun(tx, lockedRunId)) === null)
      return { kind: 'not_found' }
    const rows = await tx.$queryRaw<ApprovalLockRow[]>(Prisma.sql`
      SELECT a.id, a.state::text AS state, a."expiresAt", a."runId",
             r.status::text AS "runStatus", r."deadlineAt",
             c."ownerUserId", c."organizationId", r."conversationId", a."intentHash"
      FROM "ai"."ai_approvals" a
      JOIN "ai"."ai_runs" r ON r.id = a."runId"
      JOIN "ai"."ai_conversations" c ON c.id = r."conversationId"
      WHERE a.id = ${approvalId}
      FOR UPDATE OF a, r
    `)
    const row = rows[0]
    if (row === undefined || row.ownerUserId !== userId) return { kind: 'not_found' }

    if (!row.intentHash || input.intentHash !== row.intentHash) {
      return { kind: 'conflict', message: 'This approval does not match the displayed action.' }
    }
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock!.now
    const desired = input.decision === 'approve' ? 'APPROVED' : 'REJECTED'
    if (row.state !== 'PENDING') {
      return row.state === desired
        ? { kind: 'idempotent', response: await this.project(tx, approvalId, userId) }
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

    if (input.decision === 'approve') await this.authorizeDecision(tx, row)
    const [decisionClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const decisionTime = decisionClock!.now
    const deadlineExpired = row.deadlineAt !== null && row.deadlineAt <= decisionTime
    if (deadlineExpired || (row.expiresAt !== null && row.expiresAt <= decisionTime)) {
      await expireApproval(tx, this.audit, {
        approvalId: row.id,
        runId: row.runId,
        deadlinePassed: deadlineExpired,
        now: decisionTime,
      })
      return { kind: 'expired' }
    }
    await this.applyDecision(tx, row, input.decision, userId, decisionTime)
    return {
      kind: 'decided',
      decision: input.decision,
      runId: row.runId,
      response: await this.project(tx, approvalId, userId),
    }
  }

  /** Flip approval + invocation to the decision and re-queue the run (no retry budget is spent). */
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
    // Re-queue. The resume is a fresh lease epoch; `attemptCount` counts consumed retries only, so a
    // decision neither spends nor refunds retry budget.
    const run = await tx.aiRun.updateMany({
      where: { id: row.runId, status: AiRunStatus.WAITING_APPROVAL },
      data: {
        status: AiRunStatus.QUEUED,
        availableAt: now,
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

  /** Project only the current-rights-authorized owner preview. */
  private async project(
    tx: Prisma.TransactionClient,
    approvalId: string,
    userId: string
  ): Promise<AiApprovalResponse> {
    const approval = await tx.aiApproval.findUniqueOrThrow({
      where: { id: approvalId },
      include: { toolInvocations: { select: APPROVAL_TOOL_SELECT, take: 1 } },
    })
    return this.disclose(tx, approval, userId)
  }

  private async disclose(
    tx: Prisma.TransactionClient,
    approval: AiApprovalWithTool,
    userId: string
  ): Promise<AiApprovalResponse> {
    const response = toAiApprovalResponse(approval)
    const tool = approval.toolInvocations[0]
    if (!tool?.intentHash || tool.intentHash !== approval.intentHash) return response
    try {
      const intent = readToolIntent(tool.intentSnapshot, tool.intentHash)
      const entry = this.contracts.compatible(intent)
      if (
        !entry ||
        intent.ownerUserId !== userId ||
        intent.invocationId !== tool.id ||
        intent.runId !== approval.runId ||
        intent.conversationId !== approval.conversationId ||
        intent.toolId !== tool.toolId ||
        intent.toolVersion !== tool.toolVersion ||
        intent.riskClass !== tool.riskClass ||
        intent.idempotency !== tool.idempotency ||
        intent.originCall !== tool.originCall ||
        intent.inputSchemaHash !== tool.inputSchemaHash ||
        intent.normalizedSchemaHash !== tool.normalizedSchemaHash ||
        !canonicalJsonEqual(intent.args, tool.argsSnapshot) ||
        !(await entry.authority.canDisclose(tx, intent))
      )
        return response
      const user = await tx.user.findUnique({ where: { id: userId }, select: { locale: true } })
      const locale = coerceSupportedLocale(user?.locale)
      return {
        ...response,
        preview: intent.preview?.[locale] ?? null,
        disclosure: intent.preview ? 'available' : 'unavailable',
      }
    } catch {
      return response
    }
  }

  private async authorizeDecision(
    tx: Prisma.TransactionClient,
    row: ApprovalLockRow
  ): Promise<void> {
    const actions = await tx.aiToolInvocation.findMany({
      where: { approvalId: row.id },
      select: APPROVAL_TOOL_SELECT,
      take: 2,
    })
    const action = actions[0]
    if (actions.length !== 1 || !action?.intentHash || action.intentHash !== row.intentHash) {
      throw new ConflictException('Approval action unavailable')
    }
    let intent
    try {
      intent = readToolIntent(action.intentSnapshot, action.intentHash)
    } catch {
      throw new ConflictException('Approval action incompatible')
    }
    const entry = this.contracts.compatible(intent)
    if (
      !entry ||
      intent.ownerUserId !== row.ownerUserId ||
      intent.organizationId !== row.organizationId ||
      intent.runId !== row.runId ||
      intent.conversationId !== row.conversationId ||
      intent.invocationId !== action.id ||
      intent.toolId !== action.toolId ||
      intent.toolVersion !== action.toolVersion ||
      intent.riskClass !== action.riskClass ||
      intent.originCall !== action.originCall ||
      intent.idempotency !== action.idempotency ||
      intent.inputSchemaHash !== action.inputSchemaHash ||
      intent.normalizedSchemaHash !== action.normalizedSchemaHash ||
      !canonicalJsonEqual(intent.args, action.argsSnapshot)
    )
      throw new ConflictException('Approval action incompatible')
    const conversation = await tx.aiConversation.findUnique({
      where: { id: row.conversationId },
      select: { assistant: { select: { toolAllowlist: true } } },
    })
    if (
      !conversation?.assistant?.toolAllowlist.includes(intent.toolId) ||
      !(await entry.authority.canDisclose(tx, intent))
    )
      throw new ForbiddenException()
    await entry.authority.authorize(tx, intent, 'approve')
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
