import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { AiRunStatus, Prisma } from '@prisma/client'

import {
  AI_RUN_CLAIM_BATCH_LIMIT,
  AI_RUN_LEASE_TTL_MS,
  AI_RUN_REAP_BATCH_LIMIT,
  AiRunErrorCode,
  AiRunTerminalReason,
} from './ai-run.constants'
import { applyRunRetryAfterFloor, computeNextRunAttemptAt } from './ai-run-backoff'
import type { ClaimedRun, RunReapResult, RunRetryOutcome } from './ai-run-dispatch.types'

import { PrismaService } from '@/prisma'

/** Shape returned by the raw claim `UPDATE ... RETURNING`. */
interface ClaimedRow {
  id: string
  conversationId: string
  modelSnapshot: Prisma.JsonValue
  attemptCount: number
  maxAttempts: number
  deadlineAt: Date | null
}

/** Shape returned by the raw reaper/expiry `SELECT ... FOR UPDATE SKIP LOCKED`. */
interface ReapRow {
  id: string
  attemptCount: number
  maxAttempts: number
  deadlineAt: Date | null
}

/**
 * Durable AI-run state machine (Track C — ADR-054, ADR-052 pattern). Postgres owns claiming,
 * leasing, the retry schedule, and terminal transitions. Raw SQL is used only where Prisma has no
 * high-level equivalent — the `FOR UPDATE SKIP LOCKED` claim/reaper. Every finalizer is a CAS keyed
 * by `(id, status=RUNNING, leaseToken)`, so a stale lease holder can never overwrite newer state.
 *
 * **No provider I/O here** — the executor (Arc C.4) calls the gateway between `claimDueBatch` and a
 * finalizer, and composes a finalizer with the assistant-message + usage writes in one transaction
 * (which is why the finalizers take a `tx`). The run outcome is exactly-once via the CAS; the
 * provider call itself is at-least-once under crash/finalize failure.
 */
@Injectable()
export class AiRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically claim up to `limit` due runs: lease them (`RUNNING`), bump `attemptCount`, and stamp
   * `startedAt` — one short statement, no external I/O. Due = `QUEUED` whose `availableAt`/
   * `nextAttemptAt` have arrived and whose `deadlineAt` (if any) is still in the future (overdue
   * runs are swept to `EXPIRED` by `expireDeadlinedRuns`). `SKIP LOCKED` lets every worker drain
   * disjoint runs without blocking.
   */
  async claimDueBatch(limit: number = AI_RUN_CLAIM_BATCH_LIMIT): Promise<ClaimedRun[]> {
    const leaseToken = randomUUID()
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + AI_RUN_LEASE_TTL_MS)

    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "ai"."ai_runs" AS r
      SET status = 'RUNNING'::"ai"."AiRunStatus",
          "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "attemptCount" = r."attemptCount" + 1,
          "startedAt" = COALESCE(r."startedAt", ${now}),
          "updatedAt" = now()
      FROM (
        SELECT id FROM "ai"."ai_runs"
        WHERE status = 'QUEUED'::"ai"."AiRunStatus"
          AND "availableAt" <= now()
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
          AND ("deadlineAt" IS NULL OR "deadlineAt" > now())
        ORDER BY COALESCE("nextAttemptAt", "availableAt")
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ) AS sub
      WHERE r.id = sub.id
      RETURNING r.id, r."conversationId", r."modelSnapshot", r."attemptCount",
                r."maxAttempts", r."deadlineAt"
    `)

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      modelSnapshot: row.modelSnapshot,
      attemptNumber: row.attemptCount,
      maxAttempts: row.maxAttempts,
      deadlineAt: row.deadlineAt,
      leaseToken,
    }))
  }

  /** Run completed: CAS `RUNNING` → terminal `COMPLETED`. */
  finalizeCompleted(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.cas(tx, claim, {
      status: AiRunStatus.COMPLETED,
      finishedAt: new Date(),
      errorCode: null,
      terminalReasonCode: null,
      leaseToken: null,
      leaseExpiresAt: null,
    })
  }

  /** Permanent failure: CAS `RUNNING` → terminal `FAILED`, never retried. */
  finalizeFailed(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    errorCode: string,
    reasonCode: string = AiRunTerminalReason.PERMANENT_FAILURE
  ): Promise<boolean> {
    return this.cas(tx, claim, {
      status: AiRunStatus.FAILED,
      finishedAt: new Date(),
      errorCode,
      terminalReasonCode: reasonCode,
      leaseToken: null,
      leaseExpiresAt: null,
    })
  }

  /** Cooperative cancel observed mid-run: CAS `RUNNING` → terminal `CANCELLED`. */
  finalizeCancelled(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    reasonCode: string
  ): Promise<boolean> {
    return this.cas(tx, claim, {
      status: AiRunStatus.CANCELLED,
      finishedAt: new Date(),
      errorCode: null,
      terminalReasonCode: reasonCode,
      leaseToken: null,
      leaseExpiresAt: null,
    })
  }

  /** Deadline passed mid-run: CAS `RUNNING` → terminal `EXPIRED`. */
  finalizeExpired(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.cas(tx, claim, {
      status: AiRunStatus.EXPIRED,
      finishedAt: new Date(),
      errorCode: null,
      terminalReasonCode: AiRunTerminalReason.DEADLINE_EXCEEDED,
      leaseToken: null,
      leaseExpiresAt: null,
    })
  }

  /**
   * Transient failure: re-queue with backoff if attempts remain, else fail (exhausted). A
   * provider-requested `retryAfterMs` floors the next attempt over the normal backoff. Re-queue is
   * `RUNNING` → `QUEUED` with a future `nextAttemptAt`, so `claimDueBatch` picks it up when due.
   */
  async finalizeRetry(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    errorCode: string,
    retryAfterMs?: number
  ): Promise<RunRetryOutcome> {
    const now = new Date()
    if (claim.attemptNumber >= claim.maxAttempts) {
      const won = await this.cas(tx, claim, {
        status: AiRunStatus.FAILED,
        finishedAt: now,
        errorCode,
        terminalReasonCode: AiRunTerminalReason.ATTEMPTS_EXHAUSTED,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      return won
        ? { state: 'failed', reasonCode: AiRunTerminalReason.ATTEMPTS_EXHAUSTED }
        : { state: 'lease_lost' }
    }

    const nextAttemptAt = applyRunRetryAfterFloor(
      computeNextRunAttemptAt(claim.attemptNumber, now),
      retryAfterMs,
      now
    )
    const won = await this.cas(tx, claim, {
      status: AiRunStatus.QUEUED,
      nextAttemptAt,
      errorCode,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    return won ? { state: 'retry_scheduled', nextAttemptAt } : { state: 'lease_lost' }
  }

  /**
   * Reclaim runs whose `RUNNING` lease expired (worker crashed/stalled): expire immediately if the
   * deadline passed, otherwise re-queue if attempts remain or fail exhausted. `FOR UPDATE SKIP
   * LOCKED` serializes the reclaim against a healthy worker's finalize CAS and concurrent reapers.
   */
  async reapExpiredLeases(limit: number = AI_RUN_REAP_BATCH_LIMIT): Promise<RunReapResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const expired = await tx.$queryRaw<ReapRow[]>(Prisma.sql`
        SELECT id, "attemptCount", "maxAttempts", "deadlineAt" FROM "ai"."ai_runs"
        WHERE status = 'RUNNING'::"ai"."AiRunStatus" AND "leaseExpiresAt" < now()
        ORDER BY "leaseExpiresAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)

      let rescheduled = 0
      let failed = 0
      for (const run of expired) {
        if (run.deadlineAt !== null && run.deadlineAt <= now) {
          await tx.aiRun.update({
            where: { id: run.id },
            data: {
              status: AiRunStatus.EXPIRED,
              finishedAt: now,
              errorCode: null,
              terminalReasonCode: AiRunTerminalReason.DEADLINE_EXCEEDED,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          })
          failed += 1
          continue
        }

        const exhausted = run.attemptCount >= run.maxAttempts
        await tx.aiRun.update({
          where: { id: run.id },
          data: exhausted
            ? {
                status: AiRunStatus.FAILED,
                finishedAt: now,
                errorCode: AiRunErrorCode.LEASE_EXPIRED,
                terminalReasonCode: AiRunTerminalReason.ATTEMPTS_EXHAUSTED,
                leaseToken: null,
                leaseExpiresAt: null,
              }
            : {
                status: AiRunStatus.QUEUED,
                nextAttemptAt: computeNextRunAttemptAt(run.attemptCount, now),
                errorCode: AiRunErrorCode.LEASE_EXPIRED,
                terminalReasonCode: null,
                leaseToken: null,
                leaseExpiresAt: null,
              },
        })
        if (exhausted) failed += 1
        else rescheduled += 1
      }
      return { rescheduled, failed }
    })
  }

  /** Sweep `QUEUED` runs past their `deadlineAt` to terminal `EXPIRED` (never claimed/executed). */
  async expireDeadlinedRuns(limit: number = AI_RUN_REAP_BATCH_LIMIT): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const overdue = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "ai"."ai_runs"
        WHERE status = 'QUEUED'::"ai"."AiRunStatus"
          AND "deadlineAt" IS NOT NULL AND "deadlineAt" <= now()
        ORDER BY "deadlineAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)
      for (const run of overdue) {
        await tx.aiRun.update({
          where: { id: run.id },
          data: {
            status: AiRunStatus.EXPIRED,
            finishedAt: now,
            errorCode: null,
            terminalReasonCode: AiRunTerminalReason.DEADLINE_EXCEEDED,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
      }
      return overdue.length
    })
  }

  /** CAS a claimed run on `(id, status=RUNNING, leaseToken)`; returns false if the lease was lost. */
  private async cas(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    data: Prisma.AiRunUpdateManyMutationInput
  ): Promise<boolean> {
    const { count } = await tx.aiRun.updateMany({
      where: { id: claim.id, status: AiRunStatus.RUNNING, leaseToken: claim.leaseToken },
      data,
    })
    return count === 1
  }
}
