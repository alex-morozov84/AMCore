import { Injectable } from '@nestjs/common'
import { AiRunStatus } from '@prisma/client'

import type {
  AiRunCancelResponse,
  AiRunListQuery,
  AiRunPage,
  AiRunResponse,
  AiRunStatusValue,
} from '@amcore/shared'

import { NotFoundException } from '../../../common/exceptions'
import { AI_RUN_CANCELLED_BY_USER } from '../ai-run.constants'

import { toAiRunResponse } from './ai-run.mapper'
import { decodeAiRunCursor, encodeAiRunCursor } from './ai-run-cursor'

import { PrismaService } from '@/prisma'

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
  constructor(private readonly prisma: PrismaService) {}

  async getOwned(userId: string, id: string): Promise<AiRunResponse> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id },
      include: { conversation: { select: { ownerUserId: true } } },
    })
    if (!run || run.conversation.ownerUserId !== userId) {
      throw new NotFoundException('Ai run', id)
    }
    return toAiRunResponse(run)
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
      data: page.map(toAiRunResponse),
      nextCursor:
        hasMore && last ? encodeAiRunCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    }
  }

  /**
   * Cooperative cancel. A `QUEUED` run is claimed to terminal `CANCELLED` by CAS; a `RUNNING` run
   * records `cancellationRequestedAt` for the worker to honor; a terminal run is an idempotent
   * no-op. Returns the run's status after the call.
   */
  async cancel(userId: string, id: string): Promise<AiRunCancelResponse> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id },
      include: { conversation: { select: { ownerUserId: true } } },
    })
    if (!run || run.conversation.ownerUserId !== userId) {
      throw new NotFoundException('Ai run', id)
    }

    if (!TERMINAL_STATUSES.has(run.status)) await this.requestCancel(id)
    return this.projectCancel(id)
  }

  /** CAS a `QUEUED` run terminal; otherwise (already `RUNNING`) record a cooperative request. */
  private async requestCancel(id: string): Promise<void> {
    const claimed = await this.prisma.aiRun.updateMany({
      where: { id, status: AiRunStatus.QUEUED },
      data: {
        status: AiRunStatus.CANCELLED,
        finishedAt: new Date(),
        terminalReasonCode: AI_RUN_CANCELLED_BY_USER,
      },
    })
    if (claimed.count === 1) return
    await this.prisma.aiRun.updateMany({
      where: { id, status: AiRunStatus.RUNNING, cancellationRequestedAt: null },
      data: { cancellationRequestedAt: new Date() },
    })
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
