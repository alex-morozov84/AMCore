# Scheduled jobs

A scheduled job is a method that runs on a timer in the `worker` or `all` process
role, such as a nightly cleanup or a recovery pass that runs every 30 seconds.
Register it once and the optional Console Scheduled jobs screen
(`docs/operations-console/scheduled-jobs.md`) shows its schedule, last result and freshness. You write no page, controller,
table or permission.

Use this guide to add a job or to change how one reports its result. Queue work
(BullMQ) is separate: see [Registering background work](background-work.md).

## Add a job

Prerequisites: the service that owns the work already exists and is provided in a
worker-only module (see [Register in the correct process role](architecture-and-conventions.md#5-register-in-the-correct-process-role)).

1. **Describe the job** in
   [`scheduled-jobs.catalogue.ts`](../../apps/api/src/infrastructure/schedule/scheduled-jobs.catalogue.ts)
   and add it to `SCHEDULED_JOBS`. Use one of the two helpers:

   ```ts
   // Runs once a day on one replica (a Redis lock picks the winner).
   export const REPORT_JOB = daily('report-cleanup', CronExpression.EVERY_DAY_AT_4AM, {
     family: 'singleton',
     lock: { key: 'amcore:report:cleanup:lock', ttlMs: 30 * 60 * 1000, logName: 'report.cleanup' },
   })

   // Runs on every replica; the database decides who does the work.
   export const REPORT_POLL_JOB = frequent('report-poll', EVERY_MIN, 60_000)
   ```

   The `id` is a lowercase slug and never changes meaning. A `singleton` job needs a
   `lock`; a `per-replica` job must not have one. Keep `lock.ttlMs` at most the
   job's `graceMs` (the helper sets 30 minutes).

2. **Decorate the method** with `@ScheduledJob(definition)` instead of `@Cron` or
   `@Interval`. It registers the same schedule and adds the job's id as the
   scheduler name. It changes no locking and no overlap rule.

3. **Run the work through the executor and return an explicit result:**

   ```ts
   @ScheduledJob(REPORT_JOB)
   async scheduledCleanup(): Promise<void> {
     await this.jobs.run(REPORT_JOB, async () => {
       const result = await this.cleanup()
       return result.failed.length === 0 ? succeeded({ counts: result.counts, codes: [] }) : partial('step_failed', { counts: result.counts, codes: result.failed })
     })
   }
   ```

   Inject `ScheduledJobExecutor` (import `ScheduledJobsModule` in the module that
   provides the service). A resolved promise is **not** success: the task must say
   what happened.

The job now appears on the screen. Add a name and purpose under
`console.scheduledJobs.jobs.<id>` in `apps/web/messages/*.json` (without them the
screen shows the id). A downstream fork with the Console removed needs no change.

## Choose the result

| Return                    | When                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `succeeded(summary?)`     | The run reached its end and did its work. Doing nothing because nothing was due is success.                                    |
| `partial(code, summary?)` | The run reached its end, but some independent steps failed (buckets, lanes). The job continued after the failure.              |
| `failed(code, summary?)`  | The run stopped because of an error. If earlier steps had already committed, put their count in the summary.                   |
| `skippedFor(reason)`      | Frequent jobs only: `not_ready`, `shutdown` or `busy`. A skip never makes a job look fresh. Daily jobs must not return a skip. |

A thrown error is recorded as `failed` with the error class name as code, then
rethrown to the scheduler as before. The summary holds **counters and codes only**
(at most 16 keys, 512 bytes): never an error message, row content or user data.
A resolved result that does not describe the real outcome is a defect: classify
inside the job, at the place that knows, not around it.

Do not record a manual run or a startup attempt as a scheduled run. Call the
shared logic directly, as `POST /admin/cleanup` and the GeoIP startup/CLI path do.

## What is recorded and how it is judged

- A worker reports the job when its process starts. Each result is merged by the
  start time and run id of the run, so concurrent replicas cannot mix the fields
  of two runs.
- **Daily jobs** keep run history (latest 30 runs for 30 days; the screen shows 20).
  A success moves the due time to the next planned run. Failed, partial and
  skipped runs never move it. A job is `Overdue` when its due time plus
  `graceMs` has passed with no newer success.
- **Frequent jobs** keep one summary. A job is `Overdue` when no completed pass
  was recorded within `staleAfterMs`, which the helper sets to
  `max(10 × period, 5 minutes)`. Their current run is not tracked.
- Writing is best-effort and bounded: one write at a time, never waiting for the
  database before a job starts, never more than one connection of
  `DATABASE_POOL_MAX`, and it needs a pool of at least 2. A lost write loses an
  observation, never a run. After five failed writes only failures and partial
  results are kept for five minutes.
- Limits per job: 3 unfinished runs, 7 abandoned runs and 30 finished runs; at most
  2560 run rows and 64 jobs in total. Rows of ids that are no longer in the
  catalogue are removed when a worker starts.

Changing a job's schedule, grace or stale threshold changes its config version:
the success recorded under the old schedule stays visible but is no longer
judged by the new rule.

## Test it

- `scheduled-jobs.catalogue.spec.ts` fails when a `@Cron` or `@Interval` bypasses
  the catalogue, when a catalogue entry is not used exactly once, or when a lock
  or threshold is inconsistent. Run it after adding a job.
- Unit-test each branch of your result mapping at the place where you classify,
  with `fakeJobs()` from `scheduled-job.test-support.ts`.
- For the write path itself (merge order, caps, concurrency) the PostgreSQL suite is
  `apps/api/test/scheduled-job-evidence.e2e-spec.ts`.

## Related

- `docs/operations-console/scheduled-jobs.md`: what operators see (present when the optional Console is).
- [Deployment](../operations/deployment.md): process roles and why recovery jobs
  run on every replica without a Redis lock.
- [GeoIP setup](../operations/geoip-setup.md): the updater is one such job.
