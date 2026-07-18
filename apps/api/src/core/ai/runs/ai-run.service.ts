import { Injectable } from '@nestjs/common'

import type {
  AiRunCancelResponse,
  AiRunListQuery,
  AiRunPage,
  AiRunResponse,
  AiRunStatusValue,
} from '@amcore/shared'

import { NotFoundException } from '../../../common/exceptions'
import { AI_APPROVAL_RUN_CANCELLED, AI_RUN_CANCELLED_BY_USER } from '../ai-run.constants'

import { toAiRunResponse } from './ai-run.mapper'
import { decodeAiRunCursor, encodeAiRunCursor } from './ai-run-cursor'

import { AuditLogService } from '@/core/audit'
import {
  AiApprovalState,
  AiRunStatus,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

/** Rolls the cancel-while-waiting transaction back when the parked gate raced out from under it. */
class CancelRaceError extends Error {}

/** Terminal run states — cancellation is an idempotent no-op once a run reaches one of these. */
const TERMINAL_STATUSES: ReadonlySet<AiRunStatus> = new Set([
  AiRunStatus.COMPLETED,
  AiRunStatus.FAILED,
  AiRunStatus.CANCELLED,
  AiRunStatus.EXPIRED,
])

/**
 * Owner-scoped run reads + cancellation (Track C — ADR-054, Arc C). Ownership is derived from the
 * run's conversation (`conversation.ownerUserId`) — runs carry no owner of their own — and a
 * missing or not-owned run is a 404 so existence never leaks.
 */
@Injectable()
export class AiRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  async getOwned(userId: string, id: string): Promise<AiRunResponse> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id },
      include: {
        conversation: { select: { ownerUserId: true } },
        // The pending approval gating a parked run (Arc E.5) — a single-run hint, at most one.
        approvals: {
          where: { state: AiApprovalState.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    })
    if (!run || run.conversation.ownerUserId !== userId) {
      throw new NotFoundException('Ai run', id)
    }
    return toAiRunResponse(run, run.approvals[0]?.id ?? null)
  }

  /** Keyset-paged runs the caller owns, newest first, optionally scoped to one conversation. */
  async list(userId: string, query: AiRunListQuery): Promise<AiRunPage> {
    const cursor = query.cursor ? decodeAiRunCursor(query.cursor) : null
    const rows = await this.prisma.aiRun.findMany({
      where: {
        conversation: { ownerUserId: userId },
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })

    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const last = page.at(-1)
    return {
      data: page.map((run) => toAiRunResponse(run)),
      nextCursor:
        hasMore && last ? encodeAiRunCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    }
  }

  /**
   * Cooperative cancel. A `QUEUED` run is claimed to terminal `CANCELLED` by CAS; a `WAITING_APPROVAL`
   * run is terminalized `CANCELLED` and its parked gate voided atomically; a `RUNNING` run records
   * `cancellationRequestedAt` for the worker to honor; a terminal run is an idempotent no-op. Returns
   * the run's status after the call.
   */
  async cancel(userId: string, id: string): Promise<AiRunCancelResponse> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id },
      include: { conversation: { select: { ownerUserId: true } } },
    })
    if (!run || run.conversation.ownerUserId !== userId) {
      throw new NotFoundException('Ai run', id)
    }

    if (!TERMINAL_STATUSES.has(run.status)) await this.requestCancel(userId, id)
    return this.projectCancel(id)
  }

  /**
   * CAS a `QUEUED` run terminal, else cancel-while-waiting (void the parked gate), else (already
   * `RUNNING`) record a cooperative request. The three states are mutually exclusive; each attempt is
   * a no-op when the run has raced to a different state (the projection then reports the real status).
   */
  private async requestCancel(userId: string, id: string): Promise<void> {
    const claimed = await this.prisma.aiRun.updateMany({
      where: { id, status: AiRunStatus.QUEUED },
      data: {
        status: AiRunStatus.CANCELLED,
        finishedAt: new Date(),
        terminalReasonCode: AI_RUN_CANCELLED_BY_USER,
      },
    })
    if (claimed.count === 1) return
    if (await this.cancelWaitingApproval(userId, id)) return
    await this.prisma.aiRun.updateMany({
      where: { id, status: AiRunStatus.RUNNING, cancellationRequestedAt: null },
      data: { cancellationRequestedAt: new Date() },
    })
  }

  /**
   * Cancel-while-waiting (Arc E.5). To avoid a cancel-vs-decide/expiry DEADLOCK, it acquires the SAME
   * approval+run lock **in the same order** as the decision path (`FOR UPDATE OF a, r`, approval-driven)
   * BEFORE any mutation — so concurrent cancel/decide/cron serialize (first-writer-wins) instead of
   * lock-cycling into a Postgres abort. Under the lock it CASes `WAITING_APPROVAL → CANCELLED`, voids the
   * pending approval (`EXPIRED`) + skips the gated invocation (`SKIPPED`), all count-enforced (any ≠1
   * rolls back), and writes the content-free `ai.approval.expired` audit (`reasonCode=run_cancelled`)
   * in-tx. A later approve then sees a non-`PENDING` approval + non-`WAITING` run → 409/non-effect.
   * Returns false when the run is not a parked `WAITING_APPROVAL` (no pending approval) → try RUNNING.
   */
  private async cancelWaitingApproval(userId: string, id: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const approvalId = await this.lockPendingApproval(tx, id)
        if (approvalId === null) return false

        const now = new Date()
        const run = await tx.aiRun.updateMany({
          where: { id, status: AiRunStatus.WAITING_APPROVAL },
          data: {
            status: AiRunStatus.CANCELLED,
            finishedAt: now,
            terminalReasonCode: AI_RUN_CANCELLED_BY_USER,
          },
        })
        const voided = await tx.aiApproval.updateMany({
          where: { id: approvalId, state: AiApprovalState.PENDING },
          data: { state: AiApprovalState.EXPIRED },
        })
        const skipped = await tx.aiToolInvocation.updateMany({
          where: { runId: id, status: AiToolInvocationStatus.AWAITING_APPROVAL },
          data: { status: AiToolInvocationStatus.SKIPPED },
        })
        if (run.count !== 1 || voided.count !== 1 || skipped.count !== 1)
          throw new CancelRaceError()
        await this.recordApprovalVoided(tx, userId, approvalId, id)
        return true
      })
    } catch (error) {
      if (error instanceof CancelRaceError) return false
      throw error
    }
  }

  /**
   * Lock the run's pending approval + run rows in the decision path's order (`FOR UPDATE OF a, r`,
   * driven from the approval) and return the approval id, or `null` when the run is not parked with a
   * pending approval. This raw lock MUST precede any mutation so cancel shares the lock order.
   */
  private async lockPendingApproval(
    tx: Prisma.TransactionClient,
    runId: string
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<{ approvalId: string }[]>(Prisma.sql`
      SELECT a.id AS "approvalId"
      FROM "ai"."ai_approvals" a
      JOIN "ai"."ai_runs" r ON r.id = a."runId"
      WHERE a."runId" = ${runId}
        AND a.state = 'PENDING'::"ai"."AiApprovalState"
        AND r.status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
      FOR UPDATE OF a, r
    `)
    return rows[0]?.approvalId ?? null
  }

  /** In-tx content-free approval-void audit (the user cancelled the run the approval was gating). */
  private async recordApprovalVoided(
    tx: Prisma.TransactionClient,
    userId: string,
    approvalId: string,
    runId: string
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'ai.approval.expired',
        actorType: AuditActorType.USER,
        actorId: userId,
        targetType: AuditTargetType.AI_APPROVAL,
        targetId: approvalId,
        metadata: { approvalId, runId, reasonCode: AI_APPROVAL_RUN_CANCELLED },
      },
      { tx }
    )
  }

  private async projectCancel(id: string): Promise<AiRunCancelResponse> {
    const run = await this.prisma.aiRun.findUniqueOrThrow({ where: { id } })
    return {
      id: run.id,
      status: run.status.toLowerCase() as AiRunStatusValue,
      cancellationRequested:
        run.status === AiRunStatus.CANCELLED || run.cancellationRequestedAt !== null,
    }
  }
}
