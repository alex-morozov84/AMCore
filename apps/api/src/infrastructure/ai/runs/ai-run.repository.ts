import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  AI_RUN_CLAIM_BATCH_LIMIT,
  AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION,
  AI_RUN_GUARDRAIL_REFUSAL_MESSAGE,
  AI_RUN_LEASE_TTL_MS,
  AI_RUN_MAX_EPOCHS,
  AI_RUN_REAP_BATCH_LIMIT,
  AiRunErrorCode,
  AiRunTerminalReason,
} from './ai-run.constants'
import { closeAttempt, closeRunInvocations } from './ai-run-attempts'
import { applyRunRetryAfterFloor, computeNextRunAttemptAt } from './ai-run-backoff'
import type {
  ClaimedRun,
  GuardrailRefusalInput,
  RunReapResult,
  RunRetryOutcome,
} from './ai-run-dispatch.types'
import { sanitizeGuardrailCategories } from './guardrail-step-detail'

import {
  AiAuthorType,
  AiMessageRole,
  AiRunAttemptOutcome,
  AiRunStatus,
  AiRunStepType,
  Prisma,
} from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

/** Shape returned by the raw claim `UPDATE ... RETURNING`. */
interface ClaimedRow {
  id: string
  conversationId: string
  modelSnapshot: Prisma.JsonValue
  attemptCount: number
  maxAttempts: number
  deadlineAt: Date | null
  ownershipGeneration: number
  leaseEpoch: number
}

/** Shape returned by the raw reaper `SELECT ... FOR UPDATE SKIP LOCKED`. */
interface ReapRow {
  id: string
  attemptCount: number
  maxAttempts: number
  deadlineAt: Date | null
  cancellationRequestedAt: Date | null
  leaseEpoch: number
  ioStarted: boolean
}

/** How a transition out of `RUNNING` is recorded in the attempt history and on in-flight tools. */
interface Leaving {
  outcome: AiRunAttemptOutcome
  errorCode?: string | null
  /** `requeue` keeps read-only executions adoptable; `terminal` resolves every unfinished invocation. */
  disposition: 'terminal' | 'requeue'
}

/**
 * Durable AI-run state machine (Track C — ADR-054, ADR-052 pattern). Postgres owns claiming, leasing,
 * the retry schedule, the attempt history and terminal transitions. Raw SQL is used only where Prisma
 * has no high-level equivalent — the claim/reaper (`FOR UPDATE SKIP LOCKED`) and attempt rows.
 *
 * Every transition out of `RUNNING` is a CAS keyed by `(id, status=RUNNING, leaseToken)` that ALSO closes
 * the attempt-history row and resolves the run's in-flight tool invocations in the same transaction.
 * Callers run them inside the run guard (`AiRunGuard`), which has already locked the run and verified
 * the lease with fresh database time, so a stale holder can never reach a CAS at all.
 *
 * **No provider I/O here.** The retry budget counts consumed retries (`attemptCount`), NOT claims: a
 * claim only bumps the monotonic `leaseEpoch`, so a run whose attempt never started I/O, an approval
 * resume, or a batch-tail wait spends no budget. The provider call itself is at-least-once under crash;
 * the durable run outcome is exactly-once by the CAS.
 */
@Injectable()
export class AiRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically claim up to `limit` due runs (one per dispatch lane): lease them (`RUNNING`), bump the
   * lease epoch, open the attempt-history row and stamp `startedAt` — one short statement, no external
   * I/O. Due = `QUEUED` whose `availableAt`/`nextAttemptAt` have arrived, whose `deadlineAt` (if any) is
   * still in the future and whose epoch history is not full (a run at `AI_RUN_MAX_EPOCHS` is failed by
   * `failEpochCappedRuns`, never claimed again). `SKIP LOCKED` lets every worker drain disjoint runs.
   *
   * `AiRunBacklogCollector.collectDue()` mirrors this exact predicate for the `amcore_ai_run_due`
   * gauge — change one, change the other.
   */
  async claimDueBatch(limit: number = AI_RUN_CLAIM_BATCH_LIMIT): Promise<ClaimedRun[]> {
    const leaseToken = randomUUID()
    const ttlSeconds = AI_RUN_LEASE_TTL_MS / 1000

    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH claimed AS (
        UPDATE "ai"."ai_runs" AS r
        SET status = 'RUNNING'::"ai"."AiRunStatus",
            "leaseToken" = ${leaseToken},
            "leaseExpiresAt" = clock_timestamp() + make_interval(secs => ${ttlSeconds}::double precision),
            "leaseEpoch" = r."leaseEpoch" + 1,
            "startedAt" = COALESCE(r."startedAt", now()),
            "updatedAt" = now()
        FROM (
          SELECT id FROM "ai"."ai_runs"
          WHERE status = 'QUEUED'::"ai"."AiRunStatus"
            AND "availableAt" <= now()
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
            AND ("deadlineAt" IS NULL OR "deadlineAt" > now())
            AND "leaseEpoch" < ${AI_RUN_MAX_EPOCHS}
          ORDER BY COALESCE("nextAttemptAt", "availableAt")
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        ) AS sub
        WHERE r.id = sub.id
        RETURNING r.id, r."conversationId", r."modelSnapshot", r."attemptCount",
                  r."maxAttempts", r."deadlineAt", r."ownershipGeneration", r."leaseEpoch"
      ), attempt AS (
        INSERT INTO "ai"."ai_run_attempts" (id, "runId", epoch)
        SELECT gen_random_uuid()::text, id, "leaseEpoch" FROM claimed
      )
      SELECT * FROM claimed
    `)

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      modelSnapshot: row.modelSnapshot,
      epoch: row.leaseEpoch,
      // Retry ordinal: consumed retries + this execution. Epoch (not this) identifies the attempt.
      attemptNumber: row.attemptCount + 1,
      maxAttempts: row.maxAttempts,
      deadlineAt: row.deadlineAt,
      ownershipGeneration: row.ownershipGeneration,
      leaseToken,
    }))
  }

  /**
   * Park a claimed run for human approval (Arc E.5): CAS `RUNNING` → `WAITING_APPROVAL`, **releasing the
   * lease** (token/expiry null) so the run is unleased and non-due — the reaper (RUNNING-only) and the
   * claim query (QUEUED-only) both ignore it until a decision re-queues it or the expiry sweep resolves
   * it. Not terminal (no `finishedAt`); the attempt closes as `awaiting_approval`. Returns false when
   * the lease was already lost (roll back).
   */
  parkForApproval(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.leave(
      tx,
      claim,
      { status: AiRunStatus.WAITING_APPROVAL, leaseToken: null, leaseExpiresAt: null },
      { outcome: AiRunAttemptOutcome.AWAITING_APPROVAL, disposition: 'requeue' }
    )
  }

  /** Run completed: CAS `RUNNING` → terminal `COMPLETED`. */
  finalizeCompleted(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.leave(tx, claim, this.terminal(AiRunStatus.COMPLETED, null, null), {
      outcome: AiRunAttemptOutcome.SUCCEEDED,
      disposition: 'terminal',
    })
  }

  /** Permanent failure: CAS `RUNNING` → terminal `FAILED`, never retried. */
  finalizeFailed(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    errorCode: string,
    reasonCode: string = AiRunTerminalReason.PERMANENT_FAILURE
  ): Promise<boolean> {
    return this.leave(tx, claim, this.terminal(AiRunStatus.FAILED, errorCode, reasonCode), {
      outcome:
        reasonCode === AiRunTerminalReason.TOOL_EFFECT_UNKNOWN
          ? AiRunAttemptOutcome.EFFECT_UNKNOWN
          : AiRunAttemptOutcome.FAILED,
      errorCode,
      disposition: 'terminal',
    })
  }

  /** Cooperative cancel observed mid-run: CAS `RUNNING` → terminal `CANCELLED`. */
  finalizeCancelled(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    reasonCode: string
  ): Promise<boolean> {
    return this.leave(tx, claim, this.terminal(AiRunStatus.CANCELLED, null, reasonCode), {
      outcome: AiRunAttemptOutcome.CANCELLED,
      disposition: 'terminal',
    })
  }

  /** Deadline passed mid-run: CAS `RUNNING` → terminal `EXPIRED`. */
  finalizeExpired(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.leave(
      tx,
      claim,
      this.terminal(AiRunStatus.EXPIRED, null, AiRunTerminalReason.DEADLINE_EXCEEDED),
      { outcome: AiRunAttemptOutcome.EXPIRED, disposition: 'terminal' }
    )
  }

  /**
   * A human took control of the conversation (ADR-049 fence, Arc F): CAS `RUNNING` → terminal
   * `CANCELLED` with `superseded_by_human`, writing **no** transcript turn. The stale bot run is
   * abandoned so it can never author a message into a human-owned conversation.
   */
  finalizeSuperseded(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<boolean> {
    return this.leave(
      tx,
      claim,
      this.terminal(AiRunStatus.CANCELLED, null, AiRunTerminalReason.SUPERSEDED_BY_HUMAN),
      { outcome: AiRunAttemptOutcome.SUPERSEDED, disposition: 'terminal' }
    )
  }

  /**
   * Guardrail refusal (Track C — ADR-054 / ADR-055, Arc D): terminal **`FAILED`**, **non-retryable**,
   * plus a fixed safe transcript turn — all in the CALLER's guarded transaction, so a lost lease rolls
   * the message + steps + terminal update together. Writes, in order: a content-free check step
   * (`GUARDRAIL_CHECK`/`OUTPUT_VALIDATION` with bounded category counts), a `REFUSAL` step, a canned
   * assistant-visible refusal message (`role=ASSISTANT`, `authorType=SYSTEM`, redaction-classified —
   * so it is attributably NOT a model generation even though the run is `FAILED`) and the CAS. The
   * guard already holds the conversation lock, so the turn cannot collide on
   * `@@unique(conversationId, sequence)`. Callers invoke it only when no stop cause (cancel/takeover/
   * deadline) is visible — a stop wins over a refusal. Nothing here carries prompt/output content, the
   * boundary marker, or a snippet — only bounded reason/category codes.
   */
  async finalizeRefusal(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    refusal: GuardrailRefusalInput
  ): Promise<boolean> {
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
    return this.finalizeFailed(tx, claim, AiRunErrorCode.GUARDRAIL_BLOCKED, refusal.reasonCode)
  }

  /**
   * Transient failure: re-queue with backoff if retries remain, else fail (exhausted). A provider-requested
   * `retryAfterMs` floors the next attempt over the normal backoff. A recorded user cancel wins over a
   * retry (the run is cancelled, never re-queued). Consumes one retry: `attemptCount` becomes the retry
   * ordinal of this execution, so a fresh run still gets exactly `maxAttempts` executions.
   */
  async finalizeRetry(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    errorCode: string,
    retryAfterMs?: number
  ): Promise<RunRetryOutcome> {
    const now = new Date()
    const cancel = await tx.aiRun.findUnique({
      where: { id: claim.id },
      select: { cancellationRequestedAt: true },
    })
    if (cancel?.cancellationRequestedAt != null) {
      const won = await this.finalizeCancelled(tx, claim, AiRunTerminalReason.CANCELLED_BY_USER)
      return won
        ? { state: 'failed', reasonCode: AiRunTerminalReason.CANCELLED_BY_USER }
        : { state: 'lease_lost' }
    }
    if (claim.attemptNumber >= claim.maxAttempts) {
      const won = await this.leave(
        tx,
        claim,
        {
          ...this.terminal(AiRunStatus.FAILED, errorCode, AiRunTerminalReason.ATTEMPTS_EXHAUSTED),
          finishedAt: now,
        },
        { outcome: AiRunAttemptOutcome.FAILED, errorCode, disposition: 'terminal' }
      )
      return won
        ? { state: 'failed', reasonCode: AiRunTerminalReason.ATTEMPTS_EXHAUSTED }
        : { state: 'lease_lost' }
    }

    const nextAttemptAt = applyRunRetryAfterFloor(
      computeNextRunAttemptAt(claim.attemptNumber, now),
      retryAfterMs,
      now
    )
    const won = await this.leave(
      tx,
      claim,
      {
        status: AiRunStatus.QUEUED,
        attemptCount: claim.attemptNumber,
        nextAttemptAt,
        errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
      },
      { outcome: AiRunAttemptOutcome.RETRY_SCHEDULED, errorCode, disposition: 'requeue' }
    )
    return won ? { state: 'retry_scheduled', nextAttemptAt } : { state: 'lease_lost' }
  }

  /**
   * Reclaim runs whose `RUNNING` lease expired (worker crashed/stalled/lost the lease), under `FOR UPDATE
   * SKIP LOCKED` on the run row only — it never blocks and never takes the conversation lock, so it
   * cannot join a lock cycle with the guard. A recorded cancel becomes `CANCELLED`; a passed deadline
   * `EXPIRED`; otherwise the run is re-queued. An attempt that never admitted any I/O (`ioStartedAt`
   * unset) is requeued WITHOUT consuming retry budget (bounded by the epoch cap); one that may have
   * started I/O consumes one retry, or fails `attempts_exhausted` when none remain. Every reaped attempt
   * is closed and the run's in-flight tool invocations are resolved in the same transaction.
   */
  async reapExpiredLeases(limit: number = AI_RUN_REAP_BATCH_LIMIT): Promise<RunReapResult> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const expired = await tx.$queryRaw<ReapRow[]>(Prisma.sql`
        SELECT r.id, r."attemptCount", r."maxAttempts", r."deadlineAt", r."cancellationRequestedAt",
               r."leaseEpoch",
               COALESCE(
                 (SELECT a."ioStartedAt" IS NOT NULL FROM "ai"."ai_run_attempts" a
                  WHERE a."runId" = r.id AND a.epoch = r."leaseEpoch"),
                 true
               ) AS "ioStarted"
        FROM "ai"."ai_runs" r
        WHERE r.status = 'RUNNING'::"ai"."AiRunStatus" AND r."leaseExpiresAt" < clock_timestamp()
        ORDER BY r."leaseExpiresAt"
        FOR UPDATE OF r SKIP LOCKED
        LIMIT ${limit}
      `)

      let rescheduled = 0
      let failed = 0
      for (const run of expired) {
        const stopped = await this.reapStopped(tx, run, now)
        if (stopped) {
          failed += 1
          continue
        }
        if (await this.reapRetry(tx, run, now)) rescheduled += 1
        else failed += 1
      }
      return { rescheduled, failed }
    })
  }

  /** Reap a run that must not be retried: a recorded cancel or a passed deadline. */
  private async reapStopped(
    tx: Prisma.TransactionClient,
    run: ReapRow,
    now: Date
  ): Promise<boolean> {
    const cancelled = run.cancellationRequestedAt !== null
    if (!cancelled && !(run.deadlineAt !== null && run.deadlineAt <= now)) return false
    await tx.aiRun.update({
      where: { id: run.id },
      data: {
        ...this.terminal(
          cancelled ? AiRunStatus.CANCELLED : AiRunStatus.EXPIRED,
          null,
          cancelled ? AiRunTerminalReason.CANCELLED_BY_USER : AiRunTerminalReason.DEADLINE_EXCEEDED
        ),
        finishedAt: now,
      },
    })
    await closeAttempt(
      tx,
      run.id,
      run.leaseEpoch,
      AiRunAttemptOutcome.REAPED,
      AiRunErrorCode.LEASE_EXPIRED
    )
    await closeRunInvocations(tx, run.id, 'terminal')
    return true
  }

  /** Re-queue (or exhaust) a reaped run. Returns true when it was re-queued. */
  private async reapRetry(tx: Prisma.TransactionClient, run: ReapRow, now: Date): Promise<boolean> {
    const consumed = run.ioStarted
    const exhausted = consumed && run.attemptCount + 1 >= run.maxAttempts
    await tx.aiRun.update({
      where: { id: run.id },
      data: exhausted
        ? {
            ...this.terminal(
              AiRunStatus.FAILED,
              AiRunErrorCode.LEASE_EXPIRED,
              AiRunTerminalReason.ATTEMPTS_EXHAUSTED
            ),
            finishedAt: now,
          }
        : {
            status: AiRunStatus.QUEUED,
            attemptCount: consumed ? run.attemptCount + 1 : run.attemptCount,
            nextAttemptAt: consumed ? computeNextRunAttemptAt(run.attemptCount + 1, now) : now,
            errorCode: AiRunErrorCode.LEASE_EXPIRED,
            terminalReasonCode: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
    })
    await closeAttempt(
      tx,
      run.id,
      run.leaseEpoch,
      AiRunAttemptOutcome.REAPED,
      AiRunErrorCode.LEASE_EXPIRED
    )
    await closeRunInvocations(tx, run.id, exhausted ? 'terminal' : 'requeue')
    return !exhausted
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
            ...this.terminal(AiRunStatus.EXPIRED, null, AiRunTerminalReason.DEADLINE_EXCEEDED),
            finishedAt: now,
          },
        })
        await closeRunInvocations(tx, run.id, 'terminal')
      }
      return overdue.length
    })
  }

  /**
   * Fail `QUEUED` runs whose attempt history is full (`AI_RUN_MAX_EPOCHS`): they are never claimed again,
   * so without this sweep they would sit queued forever. History rows are never evicted or truncated.
   */
  async failEpochCappedRuns(limit: number = AI_RUN_REAP_BATCH_LIMIT): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const capped = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "ai"."ai_runs"
        WHERE status = 'QUEUED'::"ai"."AiRunStatus" AND "leaseEpoch" >= ${AI_RUN_MAX_EPOCHS}
        ORDER BY "updatedAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)
      for (const run of capped) {
        await tx.aiRun.update({
          where: { id: run.id },
          data: {
            ...this.terminal(
              AiRunStatus.FAILED,
              AiRunErrorCode.ATTEMPT_HISTORY_EXHAUSTED,
              AiRunTerminalReason.ATTEMPTS_EXHAUSTED
            ),
            finishedAt: now,
          },
        })
        await closeRunInvocations(tx, run.id, 'terminal')
      }
      return capped.length
    })
  }

  /** The column set of a terminal transition (lease released, `finishedAt` stamped now). */
  private terminal(
    status: AiRunStatus,
    errorCode: string | null,
    reasonCode: string | null
  ): Prisma.AiRunUpdateManyMutationInput {
    return {
      status,
      finishedAt: new Date(),
      errorCode,
      terminalReasonCode: reasonCode,
      leaseToken: null,
      leaseExpiresAt: null,
    }
  }

  /**
   * CAS a claimed run out of `RUNNING` on `(id, status=RUNNING, leaseToken)`; on a win, close the attempt
   * row and resolve the in-flight tool invocations in the same transaction. False = the lease was lost.
   */
  private async leave(
    tx: Prisma.TransactionClient,
    claim: ClaimedRun,
    data: Prisma.AiRunUpdateManyMutationInput,
    leaving: Leaving
  ): Promise<boolean> {
    const { count } = await tx.aiRun.updateMany({
      where: { id: claim.id, status: AiRunStatus.RUNNING, leaseToken: claim.leaseToken },
      data,
    })
    if (count !== 1) return false
    await closeAttempt(tx, claim.id, claim.epoch, leaving.outcome, leaving.errorCode ?? null)
    if (data.status !== AiRunStatus.WAITING_APPROVAL) {
      await closeRunInvocations(tx, claim.id, leaving.disposition)
    }
    return true
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
