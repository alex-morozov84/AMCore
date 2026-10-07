import { Prisma } from '@/generated/prisma/client'

/**
 * The global lock order of the AI run state machine (Track C — ADR-054): **conversation → run →
 * approval → invocation/steps**. Every path that touches a run together with its approval — owner
 * decision, cancel, approval expiry sweep, human takeover — acquires the RUN row first and the approval
 * after it, and the worker's ownership guard takes conversation → run; no path takes them in the
 * opposite order, so none can join a lock cycle with another (the reaper only ever takes the run row,
 * with `SKIP LOCKED`). A combined `FOR UPDATE OF a, r` join does not by itself define the acquisition
 * order, so callers lock the run explicitly BEFORE running such a join.
 */

/** Lock one run row `FOR UPDATE` and return its status, or `null` when it does not exist. */
export async function lockRun(
  tx: Prisma.TransactionClient,
  runId: string
): Promise<{ status: string; cancellationRequestedAt: Date | null } | null> {
  const rows = await tx.$queryRaw<{ status: string; cancellationRequestedAt: Date | null }[]>(
    Prisma.sql`
      SELECT status::text AS status, "cancellationRequestedAt"
      FROM "ai"."ai_runs"
      WHERE id = ${runId}
      FOR UPDATE
    `
  )
  return rows[0] ?? null
}

/** Resolve an approval's run id WITHOUT locking, so the run can be locked before the approval. */
export async function runIdOfApproval(
  tx: Prisma.TransactionClient,
  approvalId: string
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ runId: string | null }[]>(Prisma.sql`
    SELECT "runId" FROM "ai"."ai_approvals" WHERE id = ${approvalId}
  `)
  return rows[0]?.runId ?? null
}

/** Lock every `WAITING_APPROVAL` run of a conversation, ordered by id (deterministic multi-run order). */
export async function lockWaitingRunsOfConversation(
  tx: Prisma.TransactionClient,
  conversationId: string
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM "ai"."ai_runs"
    WHERE "conversationId" = ${conversationId}
      AND status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
    ORDER BY id
    FOR UPDATE
  `)
}

/**
 * Lock every `QUEUED` run of a conversation `FOR UPDATE`, ordered by id, and return their ids. The caller
 * must do this BEFORE touching those runs' tool invocations: a concurrent cancel holds a queued run's row
 * lock and then updates its invocation, so taking the invocation first would reverse run → invocation.
 * Under READ COMMITTED the status predicate is re-evaluated after any lock wait, so a run that stopped
 * being queued meanwhile (claimed, cancelled) is not returned.
 */
export async function lockQueuedRunsOfConversation(
  tx: Prisma.TransactionClient,
  conversationId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "ai"."ai_runs"
    WHERE "conversationId" = ${conversationId}
      AND status = 'QUEUED'::"ai"."AiRunStatus"
    ORDER BY id
    FOR UPDATE
  `)
  return rows.map((row) => row.id)
}
