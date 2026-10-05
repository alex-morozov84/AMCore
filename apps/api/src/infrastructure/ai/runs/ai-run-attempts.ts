import { AiRunAttemptOutcome, Prisma } from '@/generated/prisma/client'

/**
 * Attempt-history and in-flight-tool bookkeeping shared by every transition that takes a run out of
 * `RUNNING` (Track C — ADR-054). Each helper takes the OPEN transaction in which the run row is already
 * locked, so the history row and tool rows close atomically with the run transition itself.
 */

/** Close the open attempt row of one lease epoch. A no-op when none is open (legacy run at epoch 0). */
export async function closeAttempt(
  tx: Prisma.TransactionClient,
  runId: string,
  epoch: number,
  outcome: AiRunAttemptOutcome,
  errorCode: string | null = null
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ai"."ai_run_attempts"
    SET "endedAt" = now(),
        outcome = ${outcome}::"ai"."AiRunAttemptOutcome",
        "errorCode" = ${errorCode}
    WHERE "runId" = ${runId} AND epoch = ${epoch} AND "endedAt" IS NULL
  `)
}

/**
 * Resolve the tool invocations of a run that is leaving `RUNNING`, so no `EXECUTING` row is ever left
 * for a recovery that terminal runs never visit:
 *
 * - an `EXECUTING` side-effecting (or legacy NULL-class) invocation becomes `OUTCOME_UNKNOWN` — its
 *   external effect may have happened and must stay visible, never silently dropped;
 * - an `EXECUTING` `read_only` invocation is left for the next epoch to adopt when the run is re-queued,
 *   and is `FAILED` (`tool_abandoned`) when the run goes terminal;
 * - on a terminal transition, an invocation that never started (`REQUESTED`/`APPROVED`) is `SKIPPED`.
 *
 * Returns how many invocations were marked `OUTCOME_UNKNOWN` (so the attempt can record it).
 */
export async function closeRunInvocations(
  tx: Prisma.TransactionClient,
  runId: string,
  disposition: 'terminal' | 'requeue'
): Promise<number> {
  const unknown = await tx.$executeRaw(Prisma.sql`
    UPDATE "ai"."ai_tool_invocations"
    SET status = 'OUTCOME_UNKNOWN'::"ai"."AiToolInvocationStatus",
        "errorCode" = COALESCE("errorCode", 'tool_effect_unknown'),
        "finishedAt" = now(),
        "updatedAt" = now()
    WHERE "runId" = ${runId}
      AND status = 'EXECUTING'::"ai"."AiToolInvocationStatus"
      AND COALESCE(idempotency, 'idempotent') <> 'read_only'
  `)
  if (disposition === 'terminal') {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ai"."ai_tool_invocations"
      SET status = 'FAILED'::"ai"."AiToolInvocationStatus",
          "errorCode" = 'tool_abandoned',
          "finishedAt" = now(),
          "updatedAt" = now()
      WHERE "runId" = ${runId}
        AND status = 'EXECUTING'::"ai"."AiToolInvocationStatus"
        AND idempotency = 'read_only'
    `)
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ai"."ai_tool_invocations"
      SET status = 'SKIPPED'::"ai"."AiToolInvocationStatus",
          "updatedAt" = now()
      WHERE "runId" = ${runId}
        AND status IN ('REQUESTED'::"ai"."AiToolInvocationStatus", 'APPROVED'::"ai"."AiToolInvocationStatus")
    `)
  }
  return unknown
}
