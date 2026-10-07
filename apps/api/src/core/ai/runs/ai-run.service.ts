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
import { lockRun } from '../ai-run-locks'

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
   * Cooperative cancel. Serialized with every other state transition of the run by its row lock, and
   * decided UNDER that lock — there is no fall-through between states, so a cancel cannot be lost to an
   * approve/park/claim that races it: a `QUEUED` run is cancelled by CAS (a not-started approved tool is
   * skipped, never run); a `WAITING_APPROVAL` run is cancelled and its parked gate voided atomically; a
   * `RUNNING` run records `cancellationRequestedAt` (first request time preserved) for the worker's next
   * admission to observe — a recorded request is NOT terminal and the response says so; a terminal run is
   * an idempotent no-op. Returns the run's status after the call.
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

  /** Lock the run, then cancel according to the status seen UNDER the lock (lock order: run → approval). */
  private async requestCancel(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await lockRun(tx, id)
      if (locked === null) return
      switch (locked.status) {
        case AiRunStatus.QUEUED:
          return this.cancelQueued(tx, id)
        case AiRunStatus.WAITING_APPROVAL:
          return this.cancelWaitingApproval(tx, userId, id)
        case AiRunStatus.RUNNING:
          await tx.aiRun.updateMany({
            where: { id, status: AiRunStatus.RUNNING, cancellationRequestedAt: null },
            data: { cancellationRequestedAt: new Date() },
          })
          return
        default:
          return // terminal (or an unclaimable state): idempotent no-op
      }
    })
  }

  /** Cancel a `QUEUED` run; an approved-but-not-started tool never runs (a started effect is kept). */
  private async cancelQueued(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.aiToolInvocation.updateMany({
      where: {
        runId: id,
        status: { in: [AiToolInvocationStatus.REQUESTED, AiToolInvocationStatus.APPROVED] },
      },
      data: { status: AiToolInvocationStatus.SKIPPED },
    })
    await tx.aiRun.updateMany({
      where: { id, status: AiRunStatus.QUEUED },
      data: {
        status: AiRunStatus.CANCELLED,
        finishedAt: new Date(),
        terminalReasonCode: AI_RUN_CANCELLED_BY_USER,
      },
    })
  }

  /**
   * Cancel-while-waiting (Arc E.5), the run row already locked: take the pending approval lock AFTER it
   * (the global run → approval order every path shares), then CAS `WAITING_APPROVAL → CANCELLED`, void the
   * pending approval (`EXPIRED`) and skip the gated invocation (`SKIPPED`), all count-enforced (a mismatch
   * rolls back), and write the content-free `ai.approval.expired` audit (`reasonCode=run_cancelled`)
   * in-tx. A later approve then sees a non-`PENDING` approval + a terminal run → 409/non-effect.
   */
  private async cancelWaitingApproval(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string
  ): Promise<void> {
    const approvalId = await this.lockPendingApproval(tx, id)
    const now = new Date()
    const run = await tx.aiRun.updateMany({
      where: { id, status: AiRunStatus.WAITING_APPROVAL },
      data: {
        status: AiRunStatus.CANCELLED,
        finishedAt: now,
        terminalReasonCode: AI_RUN_CANCELLED_BY_USER,
      },
    })
    if (run.count !== 1) throw new CancelRaceError()
    if (approvalId === null) return
    const voided = await tx.aiApproval.updateMany({
      where: { id: approvalId, state: AiApprovalState.PENDING },
      data: { state: AiApprovalState.EXPIRED },
    })
    const skipped = await tx.aiToolInvocation.updateMany({
      where: { runId: id, status: AiToolInvocationStatus.AWAITING_APPROVAL },
      data: { status: AiToolInvocationStatus.SKIPPED },
    })
    if (voided.count !== 1 || skipped.count !== 1) throw new CancelRaceError()
    await this.recordApprovalVoided(tx, userId, approvalId, id)
  }

  /** The run's pending approval id, locked `FOR UPDATE` (the run row is already held by the caller). */
  private async lockPendingApproval(
    tx: Prisma.TransactionClient,
    runId: string
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<{ approvalId: string }[]>(Prisma.sql`
      SELECT a.id AS "approvalId"
      FROM "ai"."ai_approvals" a
      WHERE a."runId" = ${runId}
        AND a.state = 'PENDING'::"ai"."AiApprovalState"
      FOR UPDATE
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
