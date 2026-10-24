import { CronExpression } from '@nestjs/schedule'

import { CONTROL_LIMITS } from '../background-work/control-limits.js'

import type { ScheduledJobDefinition } from './scheduled-job.js'

const MINUTE = 60_000
const THIRTY_MINUTES = 30 * MINUTE

/** Daily jobs: a success may arrive up to the lock TTL after its due time. */
const daily = (
  id: string,
  expression: CronExpression,
  options: Pick<ScheduledJobDefinition, 'family' | 'lock' | 'disabledReason'> & {
    timeZone?: string
  }
): ScheduledJobDefinition => ({
  id,
  family: options.family,
  schedule: { kind: 'cron', expression, timeZone: options.timeZone ?? null },
  graceMs: THIRTY_MINUTES,
  ...(options.lock ? { lock: options.lock } : {}),
  ...(options.disabledReason ? { disabledReason: options.disabledReason } : {}),
})

/**
 * Frequent jobs: `staleAfter = max(10 x period, 5 min)`. It is a diagnostic threshold: no
 * completed cycle was recorded within it, which does not prove the job stopped.
 */
const frequent = (
  id: string,
  schedule: ScheduledJobDefinition['schedule'],
  periodMs: number,
  options: Pick<ScheduledJobDefinition, 'disabledReason'> = {}
): ScheduledJobDefinition => ({
  id,
  family: 'per-replica',
  schedule,
  graceMs: 0,
  staleAfterMs: Math.max(10 * periodMs, 5 * MINUTE),
  ...(options.disabledReason ? { disabledReason: options.disabledReason } : {}),
})

export const CLEANUP_JOB = daily('cleanup', CronExpression.EVERY_DAY_AT_2AM, {
  family: 'singleton',
  lock: { key: 'amcore:schedule:cleanup:lock', ttlMs: THIRTY_MINUTES, logName: 'schedule.cleanup' },
})

export const INVITATION_RETENTION_JOB = daily(
  'invitation-retention',
  CronExpression.EVERY_DAY_AT_2AM,
  { family: 'per-replica' }
)

export const NOTIFICATION_RETENTION_JOB = daily(
  'notification-retention',
  CronExpression.EVERY_DAY_AT_3AM,
  {
    family: 'singleton',
    lock: {
      key: 'amcore:notifications:retention:lock',
      ttlMs: THIRTY_MINUTES,
      logName: 'notification.retention',
    },
  }
)

export const GEOIP_UPDATE_JOB = daily('geoip-update', CronExpression.EVERY_DAY_AT_3AM, {
  family: 'singleton',
  timeZone: 'UTC',
  lock: {
    key: 'amcore:schedule:geoip:lock',
    ttlMs: THIRTY_MINUTES,
    logName: 'schedule.geoip_update',
  },
  disabledReason: (env) => (env.get('GEOIP_ENABLED') ? null : 'geoip_disabled'),
})

const EVERY_30S = {
  kind: 'cron',
  expression: CronExpression.EVERY_30_SECONDS,
  timeZone: null,
} as const
const EVERY_MIN = { kind: 'cron', expression: CronExpression.EVERY_MINUTE, timeZone: null } as const

export const NOTIFICATION_RECOVERY_JOB = frequent('notification-recovery', EVERY_30S, 30_000)
export const AI_RUN_RECOVERY_JOB = frequent('ai-run-recovery', EVERY_30S, 30_000)
export const AI_APPROVAL_EXPIRY_JOB = frequent('ai-approval-expiry', EVERY_MIN, MINUTE)
export const INVITATION_HANDOFF_JOB = frequent('invitation-handoff-sweep', EVERY_MIN, MINUTE)
/** Removing the Telegram channel removes this entry together with its job source. */
export const TELEGRAM_REACHABILITY_JOB = frequent('telegram-reachability', EVERY_MIN, MINUTE, {
  disabledReason: (env) => (env.get('TELEGRAM_BOT_TOKEN') ? null : 'telegram_not_configured'),
})
export const BACKGROUND_CONTROL_JOB = frequent(
  'background-control-maintenance',
  { kind: 'interval', everyMs: CONTROL_LIMITS.maintenance.intervalMs },
  CONTROL_LIMITS.maintenance.intervalMs
)

/** The only inventory. The Console, the recorder and the contract test all read this list. */
export const SCHEDULED_JOBS: readonly ScheduledJobDefinition[] = Object.freeze([
  CLEANUP_JOB,
  INVITATION_RETENTION_JOB,
  NOTIFICATION_RETENTION_JOB,
  GEOIP_UPDATE_JOB,
  NOTIFICATION_RECOVERY_JOB,
  AI_RUN_RECOVERY_JOB,
  AI_APPROVAL_EXPIRY_JOB,
  INVITATION_HANDOFF_JOB,
  TELEGRAM_REACHABILITY_JOB,
  BACKGROUND_CONTROL_JOB,
])

/** Hard bound shared with the table caps (64 jobs x 40 run rows = 2560). */
export const SCHEDULED_JOBS_LIMIT = 64

export function validateScheduledJobs(entries: readonly ScheduledJobDefinition[]): void {
  if (entries.length > SCHEDULED_JOBS_LIMIT)
    throw new Error(`At most ${SCHEDULED_JOBS_LIMIT} scheduled jobs may be registered`)
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(entry.id)) throw new Error(`Invalid job id: ${entry.id}`)
    if (ids.has(entry.id)) throw new Error(`Duplicate scheduled job: ${entry.id}`)
    ids.add(entry.id)
    if (entry.family === 'singleton' && !entry.lock)
      throw new Error(`Singleton job needs a lock: ${entry.id}`)
    if (entry.family === 'per-replica' && entry.lock)
      throw new Error(`Per-replica job must not hold a lock: ${entry.id}`)
    if (entry.lock && entry.graceMs < entry.lock.ttlMs)
      throw new Error(`Grace is shorter than the lock TTL: ${entry.id}`)
  }
}
