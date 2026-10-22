import { createHash } from 'node:crypto'

import { Cron, Interval } from '@nestjs/schedule'

import type {
  ScheduledJobOutcome,
  ScheduledSchedule,
  ScheduledSkipReason,
  ScheduledSummary,
} from '@amcore/shared'

import type { EnvService } from '../../env/env.service.js'

/**
 * `singleton`: one replica runs the job under a Redis lock (losing the race is normal and is not
 * recorded). `per-replica`: every replica runs it and the database claims work.
 */
export type ScheduledJobFamily = 'singleton' | 'per-replica'

/**
 * One declaration per scheduled job. It is the only place that describes a job: the scheduler
 * metadata, the recorded evidence, the Console list and the freshness rule all derive from it.
 * Add it to `SCHEDULED_JOBS` and decorate the method with `@ScheduledJob(definition)`; a contract
 * test fails when a `@Cron` / `@Interval` exists without a catalogue entry.
 */
export interface ScheduledJobDefinition {
  /** Stable slug; also the scheduler name. Never reuse an id for a different job. */
  id: string
  family: ScheduledJobFamily
  schedule: ScheduledSchedule
  /** Lock for `singleton` jobs. `logName` keeps the established `${logName}_skipped|_failed` events. */
  lock?: { key: string; ttlMs: number; logName: string }
  /**
   * Daily jobs: how long after the due time a success may still arrive before the job is stale,
   * and how long a run may stay open before it is reported as unknown. At least the lock TTL.
   */
  graceMs: number
  /**
   * Frequent jobs: no completed cycle within this time means no fresh confirmation (not that the
   * job stopped). `max(10 x period, 5 min)`.
   */
  staleAfterMs?: number
  /** Why a configuration disables the job, or `null` when enabled. Evaluated by the worker. */
  disabledReason?: (env: EnvService) => string | null
}

export type ScheduledJobCadence = 'daily' | 'frequent'

/** Daily jobs keep per-run history; frequent jobs keep only a summary. */
export function cadenceOf(definition: ScheduledJobDefinition): ScheduledJobCadence {
  return definition.staleAfterMs === undefined ? 'daily' : 'frequent'
}

/** Changes whenever the schedule or freshness policy changes, so old evidence is not judged by a new rule. */
export function configVersionOf(definition: ScheduledJobDefinition): string {
  const { id, family, schedule, graceMs, staleAfterMs } = definition
  return createHash('sha256')
    .update(JSON.stringify({ id, family, schedule, graceMs, staleAfterMs: staleAfterMs ?? null }))
    .digest('hex')
    .slice(0, 16)
}

export const SCHEDULED_JOB_METADATA = 'amcore:scheduled-job'

/**
 * Registers the standard `@Cron` / `@Interval` with the same parameters as before plus the
 * definition id as the scheduler name (needed to read the next planned fire), and tags the method
 * so the contract test can match it to the catalogue. It does not wrap the method or change locking.
 */
export function ScheduledJob(definition: ScheduledJobDefinition): MethodDecorator {
  const { schedule } = definition
  const register =
    schedule.kind === 'cron'
      ? Cron(schedule.expression, {
          name: definition.id,
          ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
        })
      : Interval(definition.id, schedule.everyMs)
  return (target, key, descriptor) => {
    register(target, key, descriptor)
    Reflect.defineMetadata(SCHEDULED_JOB_METADATA, definition.id, descriptor.value as object)
  }
}

/** What a job reports when it finishes. The executor never infers success from a resolved promise. */
export type ScheduledJobResult =
  | { outcome: ScheduledJobOutcome; code?: string; summary?: ScheduledSummary }
  | { skipped: ScheduledSkipReason }

export const succeeded = (summary?: ScheduledSummary): ScheduledJobResult =>
  summary ? { outcome: 'success', summary } : { outcome: 'success' }
export const partial = (code: string, summary?: ScheduledSummary): ScheduledJobResult => ({
  outcome: 'partial',
  code,
  ...(summary ? { summary } : {}),
})
export const failed = (code: string, summary?: ScheduledSummary): ScheduledJobResult => ({
  outcome: 'failed',
  code,
  ...(summary ? { summary } : {}),
})
export const skippedFor = (reason: ScheduledSkipReason): ScheduledJobResult => ({
  skipped: reason,
})
