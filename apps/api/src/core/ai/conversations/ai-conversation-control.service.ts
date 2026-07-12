import { Injectable } from '@nestjs/common'
import {
  AiApprovalState,
  AiConversationControl,
  AiConversationState,
  AiRunStatus,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiConversationResponse } from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../../common/exceptions'
import { AI_RUN_SUPERSEDED_BY_HUMAN } from '../ai-run.constants'
import { ApprovalRaceError } from '../approvals/ai-approval-expiry'
import { toAiConversationResponse } from '../runs/ai-run.mapper'

import { AuditLogService } from '@/core/audit'
import {
  type AiMetricsControlAction,
  type AiMetricsControlActorRole,
  MetricsService,
} from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** The human acting on a conversation: the owner, or a cross-user SUPER_ADMIN operator. */
export interface ControlActor {
  userId: string
  isSuperAdmin: boolean
}

/** The locked conversation row the control primitives read under `FOR UPDATE` (enums cast to text). */
interface LockedConversation {
  ownerUserId: string
  state: string
  controlledBy: string
  ownershipGeneration: number
  humanControlUserId: string | null
}

/** Committed control outcome; `audit` is null for an idempotent no-op (no metric/log post-commit). */
interface ControlOutcome {
  response: AiConversationResponse
  audit: {
    action: AiMetricsControlAction
    actorRole: AiMetricsControlActorRole
    supersededRuns: number
    voidedApprovals: number
  } | null
}

/**
 * Human takeover / release primitive for AI conversations (Track C — ADR-054 / ADR-049, Arc F.2b, web
 * role). **Dormant** — no controller wires it until F.3. It owns the transactional takeover state
 * machine: take control (→ `HUMAN`/`PAUSED_FOR_HUMAN`, bump `ownershipGeneration`, record the human
 * holder) and release (→ `BOT`/`ACTIVE`, clear the holder). Taking control **supersedes the unleased
 * (`QUEUED`/`WAITING_APPROVAL`) bot runs** of the conversation and **voids their `PENDING` approvals +
 * `AWAITING_APPROVAL` invocations** in the SAME transaction — leased `RUNNING` runs are left to the
 * worker fence (F.2a). Access: the owner may always take/reclaim/release their own conversation; a
 * SUPER_ADMIN operator may act cross-user but gets a 409 if another human already holds it. Audit is
 * content-free and in-tx (security evidence); metric + log are best-effort post-commit.
 */
@Injectable()
export class AiConversationControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiConversationControlService.name)
  }

  /** Seize human control of a conversation (owner or SUPER_ADMIN operator). */
  async takeControl(
    actor: ControlActor,
    conversationId: string,
    reason?: string
  ): Promise<AiConversationResponse> {
    let outcome: ControlOutcome
    try {
      outcome = await this.prisma.$transaction((tx) =>
        this.takeControlTx(tx, actor, conversationId, reason)
      )
    } catch (error) {
      // A voided approval/run CAS raced away under the lock (defensive; rolled the whole takeover back).
      if (error instanceof ApprovalRaceError) {
        throw new ConflictException('This conversation could not be taken over; its state changed.')
      }
      throw error
    }
    this.afterControl(conversationId, outcome.audit)
    return outcome.response
  }

  /** Hand control back to the bot (the current holder, or the owner force-releasing their own). */
  async releaseControl(
    actor: ControlActor,
    conversationId: string,
    reason?: string
  ): Promise<AiConversationResponse> {
    const outcome = await this.prisma.$transaction((tx) =>
      this.releaseControlTx(tx, actor, conversationId, reason)
    )
    this.afterControl(conversationId, outcome.audit)
    return outcome.response
  }

  private async takeControlTx(
    tx: Prisma.TransactionClient,
    actor: ControlActor,
    conversationId: string,
    reason: string | undefined
  ): Promise<ControlOutcome> {
    const conv = await this.lockConversation(tx, conversationId, actor)
    if (conv.state === AiConversationState.CLOSED) {
      throw new ConflictException('This conversation is closed.')
    }
    const isOwner = conv.ownerUserId === actor.userId
    // Idempotent: the same human re-taking a conversation they already hold — no generation bump.
    if (
      conv.controlledBy === AiConversationControl.HUMAN &&
      conv.humanControlUserId === actor.userId
    ) {
      return { response: await this.project(tx, conversationId), audit: null }
    }
    // Held by someone else: only the OWNER may reclaim their own conversation; an operator gets 409.
    if (conv.controlledBy === AiConversationControl.HUMAN && !isOwner) {
      throw new ConflictException('This conversation is currently held by another user.')
    }

    const fromGeneration = conv.ownershipGeneration
    const toGeneration = fromGeneration + 1
    const now = new Date()
    // Stop the bot before handing control to the human. Order matters for BOTH deadlock-safety and
    // correctness: (1) void WAITING_APPROVAL runs FIRST, under the SAME approval-driven `FOR UPDATE OF
    // a, r` lock the decide/cancel/expiry paths use (so takeover can never lock-cycle with a concurrent
    // approve into a Postgres deadlock — Arc E discipline); (2) THEN sweep QUEUED runs, which also
    // catches any run a concurrent approve just re-queued while we waited on its approval lock. Leased
    // RUNNING runs are never touched here — the worker fence supersedes them.
    const voidedApprovalRuns = await this.voidWaitingApprovalRuns(tx, actor, conversationId, now)
    const queuedSuperseded = await this.supersedeQueuedRuns(tx, conversationId, now)
    const supersededRuns = queuedSuperseded + voidedApprovalRuns.length
    const voidedApprovals = voidedApprovalRuns.length
    const updated = await tx.aiConversation.update({
      where: { id: conversationId },
      data: {
        controlledBy: AiConversationControl.HUMAN,
        state: AiConversationState.PAUSED_FOR_HUMAN,
        ownershipGeneration: toGeneration,
        humanControlUserId: actor.userId,
        humanControlAcquiredAt: now,
      },
    })

    const actorRole: AiMetricsControlActorRole = isOwner ? 'owner' : 'operator'
    await this.recordAudit(tx, 'ai.conversation.taken_over', actor, conversationId, {
      fromGeneration,
      toGeneration,
      control: 'human',
      actorRole,
      supersededRuns,
      voidedApprovals,
      reasonRef: reason,
    })
    return {
      response: toAiConversationResponse(updated),
      audit: { action: 'taken_over', actorRole, supersededRuns, voidedApprovals },
    }
  }

  private async releaseControlTx(
    tx: Prisma.TransactionClient,
    actor: ControlActor,
    conversationId: string,
    reason: string | undefined
  ): Promise<ControlOutcome> {
    const conv = await this.lockConversation(tx, conversationId, actor)
    if (conv.state === AiConversationState.CLOSED) {
      throw new ConflictException('This conversation is closed.')
    }
    const isOwner = conv.ownerUserId === actor.userId
    // Not human-held → idempotent no-op (nothing to release).
    if (conv.controlledBy !== AiConversationControl.HUMAN) {
      return { response: await this.project(tx, conversationId), audit: null }
    }
    // Only the current holder or the owner (force-release) may release; another operator gets 409.
    if (conv.humanControlUserId !== actor.userId && !isOwner) {
      throw new ConflictException('This conversation is currently held by another user.')
    }

    const fromGeneration = conv.ownershipGeneration
    const toGeneration = fromGeneration + 1
    // Release advances the generation and clears the holder; there are no bot runs to supersede (none
    // could be queued while the human held control — the producer rejects that with a 409).
    const updated = await tx.aiConversation.update({
      where: { id: conversationId },
      data: {
        controlledBy: AiConversationControl.BOT,
        state: AiConversationState.ACTIVE,
        ownershipGeneration: toGeneration,
        humanControlUserId: null,
        humanControlAcquiredAt: null,
      },
    })

    const actorRole: AiMetricsControlActorRole = isOwner ? 'owner' : 'operator'
    await this.recordAudit(tx, 'ai.conversation.released', actor, conversationId, {
      fromGeneration,
      toGeneration,
      control: 'bot',
      actorRole,
      supersededRuns: 0,
      voidedApprovals: 0,
      reasonRef: reason,
    })
    return {
      response: toAiConversationResponse(updated),
      audit: { action: 'released', actorRole, supersededRuns: 0, voidedApprovals: 0 },
    }
  }

  /**
   * Lock the conversation `FOR UPDATE` (serializing against the producer + concurrent takeovers) and
   * authorize the actor: the owner, or a SUPER_ADMIN operator. Anyone else — or a missing row — is a
   * `404` so a conversation's existence never leaks to an unauthorized caller.
   */
  private async lockConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
    actor: ControlActor
  ): Promise<LockedConversation> {
    const rows = await tx.$queryRaw<LockedConversation[]>(Prisma.sql`
      SELECT "ownerUserId",
             state::text AS state,
             "controlledBy"::text AS "controlledBy",
             "ownershipGeneration",
             "humanControlUserId"
      FROM "ai"."ai_conversations"
      WHERE id = ${conversationId}
      FOR UPDATE
    `)
    const row = rows[0]
    if (row === undefined || (row.ownerUserId !== actor.userId && !actor.isSuperAdmin)) {
      throw new NotFoundException('Conversation', conversationId)
    }
    return row
  }

  /**
   * Void every `WAITING_APPROVAL` run of the conversation and its `PENDING` gate, under the SAME
   * approval-driven `FOR UPDATE OF a, r` lock the decide (`AiApprovalService`) / cancel
   * (`AiRunService.cancelWaitingApproval`) / expiry paths take — so takeover shares one lock order and
   * can never deadlock with a concurrent approve. Ordered by `a.id` for a deterministic multi-approval
   * lock sequence. Per locked pair: CAS run → `CANCELLED`/`superseded_by_human`, approval → `EXPIRED`,
   * invocation → `SKIPPED` (each count-enforced; any ≠1 → `ApprovalRaceError` rolls the takeover back),
   * then a per-approval content-free `ai.approval.expired` audit (`reasonCode=superseded_by_human`) —
   * approval voids are security-relevant state changes, audited individually like Arc E. Returns the
   * voided `(approvalId, runId)` pairs.
   */
  private async voidWaitingApprovalRuns(
    tx: Prisma.TransactionClient,
    actor: ControlActor,
    conversationId: string,
    now: Date
  ): Promise<{ approvalId: string; runId: string }[]> {
    const locked = await tx.$queryRaw<{ approvalId: string; runId: string }[]>(Prisma.sql`
      SELECT a.id AS "approvalId", a."runId"
      FROM "ai"."ai_approvals" a
      JOIN "ai"."ai_runs" r ON r.id = a."runId"
      WHERE r."conversationId" = ${conversationId}
        AND a.state = 'PENDING'::"ai"."AiApprovalState"
        AND r.status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
      ORDER BY a.id
      FOR UPDATE OF a, r
    `)
    for (const { approvalId, runId } of locked) {
      const run = await tx.aiRun.updateMany({
        where: { id: runId, status: AiRunStatus.WAITING_APPROVAL },
        data: {
          status: AiRunStatus.CANCELLED,
          finishedAt: now,
          errorCode: null,
          terminalReasonCode: AI_RUN_SUPERSEDED_BY_HUMAN,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      const approval = await tx.aiApproval.updateMany({
        where: { id: approvalId, state: AiApprovalState.PENDING },
        data: { state: AiApprovalState.EXPIRED },
      })
      const invocation = await tx.aiToolInvocation.updateMany({
        where: { approvalId, status: AiToolInvocationStatus.AWAITING_APPROVAL },
        data: { status: AiToolInvocationStatus.SKIPPED },
      })
      if (run.count !== 1 || approval.count !== 1 || invocation.count !== 1) {
        throw new ApprovalRaceError()
      }
      await this.recordApprovalVoided(tx, actor, approvalId, runId)
    }
    return locked
  }

  /**
   * Sweep the conversation's `QUEUED` runs → `CANCELLED`/`superseded_by_human`. `QUEUED` is lease-free
   * and carries no pending approval, so this status-guarded `updateMany` is race-safe against the
   * worker's `FOR UPDATE SKIP LOCKED` claim. Run AFTER the approval void so it also catches a run a
   * concurrent approve re-queued while we held its approval lock. Returns the count.
   */
  private async supersedeQueuedRuns(
    tx: Prisma.TransactionClient,
    conversationId: string,
    now: Date
  ): Promise<number> {
    const { count } = await tx.aiRun.updateMany({
      where: { conversationId, status: AiRunStatus.QUEUED },
      data: {
        status: AiRunStatus.CANCELLED,
        finishedAt: now,
        errorCode: null,
        terminalReasonCode: AI_RUN_SUPERSEDED_BY_HUMAN,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    return count
  }

  /** In-tx content-free `ai.approval.expired` for a gate voided by a human takeover (Arc F). */
  private async recordApprovalVoided(
    tx: Prisma.TransactionClient,
    actor: ControlActor,
    approvalId: string,
    runId: string
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'ai.approval.expired',
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        targetType: AuditTargetType.AI_APPROVAL,
        targetId: approvalId,
        metadata: { approvalId, runId, reasonCode: AI_RUN_SUPERSEDED_BY_HUMAN },
      },
      { tx }
    )
  }

  /** Read + project the full conversation row (the idempotent no-op returns the unchanged state). */
  private async project(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<AiConversationResponse> {
    return toAiConversationResponse(
      await tx.aiConversation.findUniqueOrThrow({ where: { id: conversationId } })
    )
  }

  /** Content-free in-tx audit (ADR-045) — bounded generation/control/role/counts + a bounded reason ref. */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    action: 'ai.conversation.taken_over' | 'ai.conversation.released',
    actor: ControlActor,
    conversationId: string,
    meta: {
      fromGeneration: number
      toGeneration: number
      control: 'bot' | 'human'
      actorRole: AiMetricsControlActorRole
      supersededRuns: number
      voidedApprovals: number
      reasonRef: string | undefined
    }
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        targetType: AuditTargetType.AI_CONVERSATION,
        targetId: conversationId,
        metadata: { conversationId, ...meta, pinoEvent: 'ai.conversation.control' },
      },
      { tx }
    )
  }

  /** Best-effort post-commit metric + content-free log (skipped for an idempotent no-op). */
  private afterControl(conversationId: string, audit: ControlOutcome['audit']): void {
    if (audit === null) return
    this.metrics.incAiConversationControl(audit.action, audit.actorRole)
    this.logger.info(
      {
        event: 'ai.conversation.control',
        action: audit.action,
        actorRole: audit.actorRole,
        conversationId,
        supersededRuns: audit.supersededRuns,
        voidedApprovals: audit.voidedApprovals,
      },
      'AI conversation control transition'
    )
  }
}
