import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { AiAuthorType, AiMessageRole, AiRunStatus, AiRunStepType, Prisma } from '@prisma/client'

import {
  AI_RUN_CLAIM_BATCH_LIMIT,
  AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION,
  AI_RUN_GUARDRAIL_REFUSAL_MESSAGE,
  AI_RUN_LEASE_TTL_MS,
  AI_RUN_REAP_BATCH_LIMIT,
  AiRunErrorCode,
  AiRunTerminalReason,
} from './ai-run.constants'
import { applyRunRetryAfterFloor, computeNextRunAttemptAt } from './ai-run-backoff'
import type {
  ClaimedRun,
  GuardrailRefusalInput,
  RunReapResult,
  RunRetryOutcome,
} from './ai-run-dispatch.types'
import { sanitizeGuardrailCategories } from './guardrail-step-detail'

import { PrismaService } from '@/prisma'

/** Thrown inside `finalizeRefusal`'s transaction when the CAS matches no row → roll everything back. */
class RunLeaseLostError extends Error {}

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
   * Guardrail refusal (Track C — ADR-054 / ADR-055, Arc D): CAS `RUNNING` → terminal **`FAILED`**,
   * **non-retryable**, plus a fixed safe transcript turn — all in ONE self-contained transaction so
   * a lost lease rolls back the message + steps + terminal update together (the same safety property
   * as the executor's success finalizer). Writes, in order: a content-free check step
   * (`GUARDRAIL_CHECK`/`OUTPUT_VALIDATION` with bounded category counts), a `REFUSAL` step, a canned
   * assistant-visible refusal message (`role=ASSISTANT`, `authorType=SYSTEM`, redaction-classified —
   * so it is attributably NOT a model generation even though the run is `FAILED`), and the CAS. It
   * locks the conversation + allocates a sequence exactly like the success finalizer so the refusal
   * turn cannot collide on `@@unique(conversationId, sequence)`. Nothing here carries prompt/output
   * content, the boundary marker, or a snippet — only bounded reason/category codes. Returns whether
   * the CAS won (false = lease lost, everything rolled back).
   */
  async finalizeRefusal(claim: ClaimedRun, refusal: GuardrailRefusalInput): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockConversation(tx, claim.conversationId)
        const sequence = await this.nextSequence(tx, claim.conversationId)
        await tx.aiMessage.create({
          data: {
            conversationId: claim.conversationId,
            runId: claim.id,
            sequence,
            role: AiMessageRole.ASSISTANT,
            authorType: AiAuthorType.SYSTEM,
            content: [
              { type: 'text', text: AI_RUN_GUARDRAIL_REFUSAL_MESSAGE },
            ] as unknown as Prisma.InputJsonValue,
            redactionMeta: {
              classification: AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION,
            } satisfies Prisma.InputJsonValue,
          },
        })
        await this.writeRefusalSteps(tx, claim.id, refusal)
        const won = await this.cas(tx, claim, {
          status: AiRunStatus.FAILED,
          finishedAt: new Date(),
          errorCode: AiRunErrorCode.GUARDRAIL_BLOCKED,
          terminalReasonCode: refusal.reasonCode,
          leaseToken: null,
          leaseExpiresAt: null,
        })
        if (!won) throw new RunLeaseLostError()
      })
      return true
    } catch (error) {
      if (error instanceof RunLeaseLostError) return false
      throw error
    }
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

  /**
   * Append the two content-free refusal steps: the guard-stage check (bounded category counts only)
   * and the terminal `REFUSAL` marker. No prompt/output/marker/snippet is ever placed in `detail`.
   */
  private async writeRefusalSteps(
    tx: Prisma.TransactionClient,
    runId: string,
    refusal: GuardrailRefusalInput
  ): Promise<void> {
    const base = await this.nextStepNumber(tx, runId)
    const categories = sanitizeGuardrailCategories(refusal.categories)
    const detail =
      categories.length > 0 ? ({ categories } as unknown as Prisma.InputJsonValue) : undefined
    await tx.aiRunStep.createMany({
      data: [
        { runId, stepNumber: base, type: refusal.checkStepType, detail, finishedAt: new Date() },
        {
          runId,
          stepNumber: base + 1,
          type: AiRunStepType.REFUSAL,
          errorCode: refusal.reasonCode,
          finishedAt: new Date(),
        },
      ],
    })
  }

  /** Row-lock the conversation so the refusal turn serializes against concurrent appends. */
  private async lockConversation(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "ai"."ai_conversations" WHERE id = ${conversationId} FOR UPDATE
    `)
  }

  private async nextSequence(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<number> {
    const { _max } = await tx.aiMessage.aggregate({
      where: { conversationId },
      _max: { sequence: true },
    })
    return (_max.sequence ?? -1) + 1
  }

  private async nextStepNumber(tx: Prisma.TransactionClient, runId: string): Promise<number> {
    const { _max } = await tx.aiRunStep.aggregate({
      where: { runId },
      _max: { stepNumber: true },
    })
    return (_max.stepNumber ?? 0) + 1
  }
}
