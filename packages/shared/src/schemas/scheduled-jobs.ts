import { z } from 'zod'

const count = z.number().int().nonnegative()
const instant = z.iso.datetime()

/**
 * A bounded slug rather than a shared enum: a job registered downstream must never
 * break parsing of this privileged read. Known ids get fixed UI copy, others show the id.
 */
export const scheduledJobIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9._-]*$/)

/** `singleton`: one replica runs it under a Redis lock. `per-replica`: every replica runs it (DB claims). */
export const SCHEDULED_JOB_FAMILIES = ['singleton', 'per-replica'] as const
/** `daily`-class jobs keep run history; `frequent` jobs keep only a summary. */
export const SCHEDULED_JOB_CADENCES = ['daily', 'frequent'] as const

export const SCHEDULED_JOB_OUTCOMES = ['success', 'partial', 'failed'] as const
/** The only reasons a run is recorded as skipped. Losing the Redis lock race is normal and is not recorded. */
export const SCHEDULED_SKIP_REASONS = ['lock_unavailable', 'not_ready', 'shutdown', 'busy'] as const

export const scheduledJobOutcomeSchema = z.enum(SCHEDULED_JOB_OUTCOMES)
export const scheduledSkipReasonSchema = z.enum(SCHEDULED_SKIP_REASONS)
export type ScheduledJobOutcome = z.infer<typeof scheduledJobOutcomeSchema>
export type ScheduledSkipReason = z.infer<typeof scheduledSkipReasonSchema>

export const SCHEDULED_SUMMARY_MAX_KEYS = 16
export const SCHEDULED_SUMMARY_MAX_BYTES = 512
export const SCHEDULED_HISTORY_PAGE = 20
export const SCHEDULED_JOBS_MAX = 64

const summaryKey = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)

/** Counters and codes only: no row content, no free text, no error messages. */
export const scheduledSummarySchema = z.strictObject({
  counts: z.record(summaryKey, count).refine((value) => Object.keys(value).length <= 16),
  codes: z.array(summaryKey).max(8),
})
export type ScheduledSummary = z.infer<typeof scheduledSummarySchema>

export const scheduledScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cron'),
    expression: z.string().min(1).max(64),
    timeZone: z.string().min(1).max(64).nullable(),
  }),
  z.strictObject({ kind: z.literal('interval'), everyMs: z.number().int().positive() }),
])
export type ScheduledSchedule = z.infer<typeof scheduledScheduleSchema>

/** Axis 1. `not_reported`: no worker has registered the job, so nothing is known about its configuration. */
export const scheduledConfigSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('enabled'),
    reportedAt: instant,
    scheduleTimeZone: z.string().min(1).max(64).nullable(),
  }),
  z.strictObject({
    state: z.literal('disabled'),
    reason: summaryKey,
    reportedAt: instant,
  }),
  z.strictObject({ state: z.literal('not_reported') }),
])
export type ScheduledConfig = z.infer<typeof scheduledConfigSchema>

/**
 * Axis 2. `running`: an open run within its maximum runtime. `unknown`: a run started but no end was
 * recorded. `none`: nothing recorded. `at` is the run start.
 */
export const scheduledResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('running'), startedAt: instant }),
  z.strictObject({ state: z.literal('unknown'), startedAt: instant }),
  z.strictObject({
    state: scheduledJobOutcomeSchema,
    startedAt: instant,
    durationMs: count,
    code: summaryKey.nullable(),
    summary: scheduledSummarySchema.nullable(),
  }),
])
export type ScheduledResult = z.infer<typeof scheduledResultSchema>

/**
 * Axis 3. `stale`: no successful run covered the due time. `unknown`: freshness cannot be judged
 * (job disabled or never reported). `dueAt` is the time the next success was required by.
 */
export const scheduledFreshnessSchema = z.strictObject({
  state: z.enum(['fresh', 'stale', 'unknown']),
  dueAt: instant.nullable(),
})
export type ScheduledFreshness = z.infer<typeof scheduledFreshnessSchema>

export const scheduledJobSchema = z.strictObject({
  id: scheduledJobIdSchema,
  family: z.enum(SCHEDULED_JOB_FAMILIES),
  cadence: z.enum(SCHEDULED_JOB_CADENCES),
  schedule: scheduledScheduleSchema,
  config: scheduledConfigSchema,
  result: scheduledResultSchema,
  /** Shown only when newer than `result`; it never changes `lastSuccess` or freshness. */
  skip: z.strictObject({ at: instant, reason: scheduledSkipReasonSchema }).nullable(),
  freshness: scheduledFreshnessSchema,
  lastSuccess: z
    .strictObject({ startedAt: instant, durationMs: count, underCurrentConfig: z.boolean() })
    .nullable(),
  /** As reported by a worker; it can lie in the past when no worker is reporting. */
  nextFireAt: instant.nullable(),
  droppedEvents: count,
})
export type ScheduledJob = z.infer<typeof scheduledJobSchema>

export const scheduledJobsResponseSchema = z.strictObject({
  checkedAt: instant,
  jobs: z.array(scheduledJobSchema).max(SCHEDULED_JOBS_MAX),
})
export type ScheduledJobsResponse = z.infer<typeof scheduledJobsResponseSchema>

export const scheduledRunSchema = z.strictObject({
  runId: z.uuid(),
  startedAt: instant,
  finishedAt: instant.nullable(),
  state: z.enum(['running', 'unknown', ...SCHEDULED_JOB_OUTCOMES]),
  durationMs: count.nullable(),
  code: summaryKey.nullable(),
  summary: scheduledSummarySchema.nullable(),
})
export type ScheduledRun = z.infer<typeof scheduledRunSchema>

export const scheduledRunsResponseSchema = z.strictObject({
  jobId: scheduledJobIdSchema,
  checkedAt: instant,
  /** Newest first, at most `SCHEDULED_HISTORY_PAGE`. */
  runs: z.array(scheduledRunSchema).max(SCHEDULED_HISTORY_PAGE),
  /** True when the table holds older retained runs than the ones returned. */
  truncated: z.boolean(),
})
export type ScheduledRunsResponse = z.infer<typeof scheduledRunsResponseSchema>
