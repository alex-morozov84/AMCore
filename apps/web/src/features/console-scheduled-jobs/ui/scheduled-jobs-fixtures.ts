import type { ScheduledJob, ScheduledJobsResponse } from '@amcore/shared'

const base = {
  family: 'singleton',
  cadence: 'daily',
  schedule: { kind: 'cron', expression: '0 02 * * *', timeZone: null },
  config: { state: 'enabled', reportedAt: '2026-10-21T09:00:00.000Z', scheduleTimeZone: 'UTC' },
  result: { state: 'none' },
  skip: null,
  freshness: { state: 'fresh', dueAt: '2026-10-22T02:00:00.000Z' },
  lastSuccess: null,
  nextFireAt: '2026-10-22T02:00:00.000Z',
  droppedEvents: 0,
} as const

export const job = (over: Partial<ScheduledJob> & { id: string }): ScheduledJob =>
  ({ ...base, ...over }) as ScheduledJob

const settled = (
  state: 'success' | 'partial' | 'failed',
  extra: Partial<{ code: string | null; codes: string[] }> = {}
): ScheduledJob['result'] => ({
  state,
  startedAt: '2026-10-21T02:00:00.000Z',
  durationMs: 1240,
  code: extra.code ?? null,
  summary: extra.codes ? { counts: {}, codes: extra.codes } : null,
})

export const succeededJob = job({
  id: 'cleanup',
  result: settled('success'),
  lastSuccess: {
    startedAt: '2026-10-21T02:00:00.000Z',
    durationMs: 4000,
    underCurrentConfig: true,
  },
})
export const partialJob = job({
  id: 'notification-retention',
  result: settled('partial', { code: 'bucket_failed', codes: ['expiredSessions'] }),
  freshness: { state: 'stale', dueAt: '2026-10-20T03:00:00.000Z' },
})
export const unknownJob = job({
  id: 'invitation-retention',
  family: 'per-replica',
  result: { state: 'unknown', startedAt: '2026-10-21T06:00:00.000Z' },
  freshness: { state: 'stale', dueAt: '2026-10-20T02:00:00.000Z' },
})
export const failedJob = job({
  id: 'downstream-report',
  result: settled('failed', { code: 'all_buckets_failed' }),
})
export const disabledJob = job({
  id: 'geoip-update',
  config: { state: 'disabled', reason: 'geoip_disabled', reportedAt: '2026-10-21T09:00:00.000Z' },
  freshness: { state: 'unknown', dueAt: null },
})
export const frequentJob = job({
  id: 'notification-recovery',
  family: 'per-replica',
  cadence: 'frequent',
  schedule: { kind: 'cron', expression: '*/30 * * * * *', timeZone: null },
  result: settled('success'),
  skip: { at: '2026-10-21T09:10:00.000Z', reason: 'busy' },
})
export const notReportedJob = job({
  id: 'ai-run-recovery',
  config: { state: 'not_reported' },
  freshness: { state: 'unknown', dueAt: null },
})

export const response = (jobs: ScheduledJob[]): ScheduledJobsResponse => ({
  checkedAt: '2026-10-21T09:20:00.000Z',
  jobs,
})
