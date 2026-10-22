import type { Prisma } from '../../generated/prisma/client.js'

import type { RunFinish, RunStart } from './scheduled-job-pending.js'

/** Hard caps. Changing one needs a migration review and an ADR update. */
export const RUN_CAPS = {
  open: 3,
  abandoned: 7,
  terminal: 30,
  historyDays: 30,
  rows: 2560,
} as const

/** One advisory lock serializes every writer of the run table, so the caps hold under concurrency. */
const LOCK = 'scheduled_job_run'

export const takeRunLock = (tx: Prisma.TransactionClient): Promise<unknown> =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`

/**
 * Brings one job back inside its caps: terminal <= 30, abandoned <= 7, nothing older than
 * 30 days. Open rows are left alone. Deletion is unbounded on purpose: one job's rows are
 * already bounded by the previous caps.
 */
export async function trimJob(
  tx: Prisma.TransactionClient,
  jobId: string,
  dbNow: string
): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM core.scheduled_job_runs WHERE "runId" IN (
      SELECT "runId" FROM (
        SELECT "runId", "startedAt",
          CASE WHEN outcome IS NULL THEN 'open' WHEN outcome = 'unknown' THEN 'abandoned'
               ELSE 'terminal' END AS class,
          row_number() OVER (
            PARTITION BY CASE WHEN outcome IS NULL THEN 'open' WHEN outcome = 'unknown'
                              THEN 'abandoned' ELSE 'terminal' END
            ORDER BY "startedAt" DESC, "runId" DESC) AS position
        FROM core.scheduled_job_runs WHERE "jobId" = ${jobId}
      ) ranked
      WHERE (class = 'terminal' AND position > ${RUN_CAPS.terminal})
         OR (class = 'abandoned' AND position > ${RUN_CAPS.abandoned})
         OR (class <> 'open'
             AND "startedAt" < ${dbNow}::timestamptz - make_interval(days => ${RUN_CAPS.historyDays}))
    )`
}

/**
 * Admits and inserts one run. Order matters: abandon stale open rows, trim, check the open and
 * table caps, and only then insert, so the post-insert state never exceeds a cap. Returns false when
 * the run is not tracked; the caller counts the lost observation.
 */
export async function startRun(
  tx: Prisma.TransactionClient,
  start: RunStart,
  startedAt: string,
  dbNow: string,
  knownJobIds: string[]
): Promise<boolean> {
  await tx.$executeRaw`
    UPDATE core.scheduled_job_runs SET outcome = 'unknown'
    WHERE "jobId" = ${start.jobId} AND outcome IS NULL
      AND "startedAt" < ${dbNow}::timestamptz - make_interval(secs => ${start.maxRuntimeMs / 1000})`
  await trimJob(tx, start.jobId, dbNow)
  const [counts] = await tx.$queryRaw<{ open: bigint; total: bigint }[]>`
    SELECT count(*) FILTER (WHERE "jobId" = ${start.jobId} AND outcome IS NULL) AS open,
           count(*) AS total
    FROM core.scheduled_job_runs`
  if (Number(counts?.open ?? 0) >= RUN_CAPS.open) return false
  if (Number(counts?.total ?? 0) >= RUN_CAPS.rows) {
    // Table full: evict the oldest finished rows of jobs this process does not know.
    await tx.$executeRaw`
      DELETE FROM core.scheduled_job_runs WHERE "runId" IN (
        SELECT "runId" FROM core.scheduled_job_runs
        WHERE "jobId" <> ALL(${knownJobIds}::text[]) AND outcome IS NOT NULL
        ORDER BY "startedAt" LIMIT 100)`
    const [after] = await tx.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM core.scheduled_job_runs`
    if (Number(after?.total ?? 0) >= RUN_CAPS.rows) return false
  }
  await tx.$executeRaw`
    INSERT INTO core.scheduled_job_runs ("runId", "jobId", "startedAt")
    VALUES (${start.runId}::uuid, ${start.jobId}, ${startedAt}::timestamptz)
    ON CONFLICT ("runId") DO NOTHING`
  return true
}

/**
 * Closes only its own run (open, or abandoned and now known to have ended), then trims terminal
 * rows. Resolves `false` when there was no such row (nothing changed there; the summary snapshot
 * is written separately by key), so the caller can count the lost observation.
 */
export async function finishRun(
  tx: Prisma.TransactionClient,
  finish: RunFinish,
  finishedAt: string,
  dbNow: string
): Promise<boolean> {
  const summary = finish.summary === null ? null : JSON.stringify(finish.summary)
  const updated = await tx.$executeRaw`
    UPDATE core.scheduled_job_runs SET
      outcome = ${finish.outcome}, "finishedAt" = ${finishedAt}::timestamptz,
      "durationMs" = ${finish.durationMs}, code = ${finish.code}, summary = ${summary}::jsonb
    WHERE "runId" = ${finish.runId}::uuid AND (outcome IS NULL OR outcome = 'unknown')`
  await trimJob(tx, finish.jobId, dbNow)
  return updated > 0
}
