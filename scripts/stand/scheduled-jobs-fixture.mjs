import { setTimeout as delay } from 'node:timers/promises'
import { sql } from './ownership.mjs'
import { save } from './state.mjs'

const JOBS = 9

/**
 * Managed preview rows for the Scheduled jobs screen. The running worker registers the jobs and
 * records the frequent ones by itself; this fixture only gives the daily jobs a history, because
 * they would otherwise stay "No runs yet" until the next 02:00. Every row is written through the
 * marker-locked fixture SQL, and a repeat run never undoes later changes.
 *
 * Seeded states: cleanup is partly done and overdue, notification retention failed and is overdue,
 * invitation retention started and never reported its end. GeoIP is turned off by the stand.
 */
export async function scheduledJobsFixture(m) {
  const record = (m.scheduledJobsFixture ??= { version: 1 })
  if (record.prepared) return
  let ready = 0
  for (let attempt = 0; attempt < 60 && ready < JOBS; attempt += 1) {
    ready = Number(
      (await sql(m, 'SELECT count(*) FROM core.scheduled_job_summaries;')).trim() || '0'
    )
    if (ready < JOBS) await delay(2000)
  }
  if (ready < JOBS) throw new Error('Scheduled jobs: the worker has not registered its jobs yet')

  await sql(
    m,
    `UPDATE core.scheduled_job_summaries SET
       "successStartedAt" = clock_timestamp() - interval '50 hours',
       "successRunId" = gen_random_uuid(),
       "successFinishedAt" = clock_timestamp() - interval '50 hours' + interval '4 seconds',
       "successDurationMs" = 4000,
       "successSummary" = '{"counts":{"expiredSessions":212,"expiredPasswordResetTokens":3,"expiredEmailVerificationTokens":0,"staleTerminalApiKeys":0,"expiredPendingInvites":1,"staleTerminalInvites":0},"codes":[]}'::jsonb,
       "successDueAt" = clock_timestamp() - interval '26 hours',
       "successConfigVersion" = "configVersion",
       "partialStartedAt" = clock_timestamp() - interval '2 hours',
       "partialRunId" = gen_random_uuid(),
       "partialFinishedAt" = clock_timestamp() - interval '2 hours' + interval '1200 milliseconds',
       "partialDurationMs" = 1200,
       "partialCode" = 'bucket_failed',
       "partialSummary" = '{"counts":{"expiredSessions":0,"expiredPasswordResetTokens":3,"expiredEmailVerificationTokens":0,"staleTerminalApiKeys":0,"expiredPendingInvites":1,"staleTerminalInvites":0},"codes":["expiredSessions"]}'::jsonb
     WHERE "jobId" = 'cleanup';
     UPDATE core.scheduled_job_summaries SET
       "successStartedAt" = clock_timestamp() - interval '50 hours',
       "successRunId" = gen_random_uuid(),
       "successFinishedAt" = clock_timestamp() - interval '50 hours' + interval '9 seconds',
       "successDurationMs" = 9000,
       "successSummary" = '{"counts":{"archivedNotifications":0,"readNotifications":41,"unreadNotifications":0,"finishedAttempts":120,"telegramLinkTokens":2,"telegramUpdateReceipts":0},"codes":[]}'::jsonb,
       "successDueAt" = clock_timestamp() - interval '26 hours',
       "successConfigVersion" = "configVersion",
       "failureStartedAt" = clock_timestamp() - interval '1 hour',
       "failureRunId" = gen_random_uuid(),
       "failureFinishedAt" = clock_timestamp() - interval '1 hour' + interval '700 milliseconds',
       "failureDurationMs" = 700,
       "failureCode" = 'all_buckets_failed',
       "failureSummary" = '{"counts":{"archivedNotifications":0,"readNotifications":0,"unreadNotifications":0,"finishedAttempts":0,"telegramLinkTokens":0,"telegramUpdateReceipts":0},"codes":["archivedNotifications","readNotifications","unreadNotifications","finishedAttempts","telegramLinkTokens","telegramUpdateReceipts"]}'::jsonb
     WHERE "jobId" = 'notification-retention';
     UPDATE core.scheduled_job_summaries SET
       "successStartedAt" = clock_timestamp() - interval '74 hours',
       "successRunId" = gen_random_uuid(),
       "successFinishedAt" = clock_timestamp() - interval '74 hours' + interval '2 seconds',
       "successDurationMs" = 2000,
       "successSummary" = '{"counts":{"stepsCompleted":4},"codes":[]}'::jsonb,
       "successDueAt" = clock_timestamp() - interval '50 hours',
       "successConfigVersion" = "configVersion"
     WHERE "jobId" = 'invitation-retention';`
  )
  await sql(
    m,
    `INSERT INTO core.scheduled_job_runs ("runId", "jobId", "startedAt", "finishedAt", outcome, "durationMs", code, summary)
     VALUES
       (gen_random_uuid(), 'cleanup', clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours' + interval '1200 milliseconds', 'partial', 1200, 'bucket_failed', '{"counts":{},"codes":["expiredSessions"]}'::jsonb),
       (gen_random_uuid(), 'cleanup', clock_timestamp() - interval '26 hours', clock_timestamp() - interval '26 hours' + interval '4 seconds', 'success', 4000, NULL, NULL),
       (gen_random_uuid(), 'cleanup', clock_timestamp() - interval '50 hours', clock_timestamp() - interval '50 hours' + interval '4 seconds', 'success', 4000, NULL, NULL),
       (gen_random_uuid(), 'cleanup', clock_timestamp() - interval '74 hours', clock_timestamp() - interval '74 hours' + interval '3 seconds', 'failed', 3000, 'all_buckets_failed', NULL),
       (gen_random_uuid(), 'notification-retention', clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 hour' + interval '700 milliseconds', 'failed', 700, 'all_buckets_failed', NULL),
       (gen_random_uuid(), 'notification-retention', clock_timestamp() - interval '50 hours', clock_timestamp() - interval '50 hours' + interval '9 seconds', 'success', 9000, NULL, NULL),
       (gen_random_uuid(), 'invitation-retention', clock_timestamp() - interval '74 hours', clock_timestamp() - interval '74 hours' + interval '2 seconds', 'success', 2000, NULL, NULL);
     INSERT INTO core.scheduled_job_runs ("runId", "jobId", "startedAt")
     VALUES (gen_random_uuid(), 'invitation-retention', clock_timestamp() - interval '3 hours');`
  )
  record.prepared = true
  await save(m)
  console.log(
    'Scheduled jobs: cleanup partly done and overdue; notification cleanup failed and overdue; invitation cleanup started with no recorded end; GeoIP turned off.'
  )
}
