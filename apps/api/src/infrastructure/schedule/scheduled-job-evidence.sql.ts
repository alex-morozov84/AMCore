import { Prisma } from '../../generated/prisma/client.js'

import type { Evidence, EvidenceKind } from './scheduled-job-pending.js'

/** Column prefixes are a closed set, so they are safe to splice into SQL as identifiers. */
const KINDS: Record<EvidenceKind, string> = {
  success: 'success',
  partial: 'partial',
  failure: 'failure',
  skip: 'skip',
}

export type ToDbTime = (mono: number) => string

const TABLE = Prisma.raw('core.scheduled_job_summaries')

const json = (value: unknown): string | null => (value === null ? null : JSON.stringify(value))

/**
 * Writes one outcome kind for many jobs. A snapshot is replaced only by a newer
 * `(startedAt, runId)` key, and every field of the snapshot is written together, so the code and
 * summary always belong to the same run as the time. An empty snapshot (null key) accepts any event.
 */
export function mergeKind(kind: EvidenceKind, items: Evidence[], toDb: ToDbTime): Prisma.Sql {
  const started = Prisma.raw(`"${KINDS[kind]}StartedAt"`)
  const runId = Prisma.raw(`"${KINDS[kind]}RunId"`)
  const col = (name: string): Prisma.Sql => Prisma.raw(`"${KINDS[kind]}${name}"`)
  const jobs = items.map((item) => item.jobId)
  const starts = items.map((item) => toDb(item.startMono))
  const runs = items.map((item) => item.runId)
  const ends = items.map((item) => toDb(item.endMono))
  const durations = items.map((item) => item.durationMs)
  const codes = items.map((item) => item.code)
  const summaries = items.map((item) => json(item.summary))
  const guard = Prisma.sql`s.${started} IS NULL OR (v.started, v.run) > (s.${started}, s.${runId})`

  if (kind === 'skip') {
    return Prisma.sql`UPDATE ${TABLE} s SET
        ${started} = v.started, ${runId} = v.run, ${col('Reason')} = v.reason
      FROM unnest(${jobs}::text[], ${starts}::timestamptz[], ${runs}::uuid[], ${items.map((i) => i.skipReason)}::text[])
        AS v(job, started, run, reason)
      WHERE s."jobId" = v.job AND (${guard})`
  }
  const due = items.map((item) => item.dueAt?.toISOString() ?? null)
  const config = items.map((item) => (kind === 'success' ? item.configVersion : null))
  const successOnly =
    kind === 'success'
      ? Prisma.sql`, ${col('DueAt')} = v.due, ${col('ConfigVersion')} = v.config`
      : Prisma.empty
  return Prisma.sql`UPDATE ${TABLE} s SET
      ${started} = v.started, ${runId} = v.run, ${col('FinishedAt')} = v.finished,
      ${col('DurationMs')} = v.duration, ${col('Code')} = v.code,
      ${col('Summary')} = v.summary::jsonb${successOnly}
    FROM unnest(${jobs}::text[], ${starts}::timestamptz[], ${runs}::uuid[], ${ends}::timestamptz[],
      ${durations}::int[], ${codes}::text[], ${summaries}::text[], ${due}::timestamptz[], ${config}::text[])
      AS v(job, started, run, finished, duration, code, summary, due, config)
    WHERE s."jobId" = v.job AND (${guard})`
}

/** Display fields that every flushed job refreshes, plus the observations that were lost. */
export function touch(
  items: Evidence[],
  dropped: Map<string, number>,
  dbNow: string
): Prisma.Sql | null {
  const next = new Map<string, string | null>()
  for (const item of items) next.set(item.jobId, item.nextFireAt?.toISOString() ?? null)
  for (const jobId of dropped.keys()) if (!next.has(jobId)) next.set(jobId, null)
  if (next.size === 0) return null
  const jobs = [...next.keys()]
  return Prisma.sql`UPDATE ${TABLE} s SET
      "nextFireAt" = COALESCE(v.next, s."nextFireAt"),
      "droppedEvents" = s."droppedEvents" + v.dropped,
      "recordedAt" = ${dbNow}::timestamptz
    FROM unnest(${jobs}::text[], ${jobs.map((jobId) => next.get(jobId) ?? null)}::timestamptz[],
      ${jobs.map((jobId) => dropped.get(jobId) ?? 0)}::int[]) AS v(job, next, dropped)
    WHERE s."jobId" = v.job`
}
