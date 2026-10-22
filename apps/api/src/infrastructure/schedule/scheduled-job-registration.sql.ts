import type { Prisma } from '../../generated/prisma/client.js'

/** What one worker reports about one job when it starts. */
export interface Registration {
  jobId: string
  configVersion: string
  scheduleTimeZone: string | null
  disabledReason: string | null
  nextFireAt: Date | null
}

/**
 * Registers the process's catalogue. Existing evidence is kept. The first-registration time and
 * the baseline due time are never moved by a restart, so repeated restarts cannot postpone the
 * moment a job that never succeeded becomes stale; a changed config version restarts the baseline.
 * Rows of ids outside the catalogue are removed (bounded by the table caps), which keeps the
 * tables inside their hard caps across catalogue changes.
 */
export async function register(
  tx: Prisma.TransactionClient,
  items: Registration[],
  dbNow: string
): Promise<void> {
  const ids = items.map((item) => item.jobId)
  await tx.$executeRaw`
    DELETE FROM core.scheduled_job_runs WHERE "jobId" <> ALL(${ids}::text[])`
  await tx.$executeRaw`
    DELETE FROM core.scheduled_job_summaries WHERE "jobId" <> ALL(${ids}::text[])`
  await tx.$executeRaw`
    INSERT INTO core.scheduled_job_summaries AS s (
      "jobId", "firstRegisteredAt", "lastRegisteredAt", "configVersion", "scheduleTimeZone",
      enabled, "disabledReason", "nextFireAt", "baselineDueAt", "recordedAt")
    SELECT v.job, ${dbNow}::timestamptz, ${dbNow}::timestamptz, v.config, v.zone,
           v.reason IS NULL, v.reason, v.next, v.next, ${dbNow}::timestamptz
    FROM unnest(${ids}::text[], ${items.map((item) => item.configVersion)}::text[],
      ${items.map((item) => item.scheduleTimeZone)}::text[],
      ${items.map((item) => item.disabledReason)}::text[],
      ${items.map((item) => item.nextFireAt?.toISOString() ?? null)}::timestamptz[])
      AS v(job, config, zone, reason, next)
    ON CONFLICT ("jobId") DO UPDATE SET
      "lastRegisteredAt" = EXCLUDED."lastRegisteredAt",
      "baselineDueAt" = CASE WHEN s."configVersion" <> EXCLUDED."configVersion"
        THEN EXCLUDED."baselineDueAt" ELSE COALESCE(s."baselineDueAt", EXCLUDED."baselineDueAt") END,
      "configVersion" = EXCLUDED."configVersion",
      "scheduleTimeZone" = EXCLUDED."scheduleTimeZone",
      enabled = EXCLUDED.enabled, "disabledReason" = EXCLUDED."disabledReason",
      "nextFireAt" = EXCLUDED."nextFireAt", "recordedAt" = EXCLUDED."recordedAt"`
}
