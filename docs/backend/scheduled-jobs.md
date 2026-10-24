# Scheduled jobs

A scheduled job is a method that runs on a timer in the `worker` or `all` process
role, such as a nightly cleanup or a recovery pass that runs every 30 seconds.
Register it once and the optional Operations Console shows its schedule, last result
and freshness on its Scheduled jobs screen. You write no page, controller, table or
permission.

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

   `daily(id, cronExpression, options)` and `frequent(id, schedule, periodMs)` are
   helpers private to that catalogue file, next to the `EVERY_30S` and `EVERY_MIN`
   schedule constants. For `frequent`, the third argument is the period in
   milliseconds; the helper derives the stale threshold from it. A cron job runs in
   the process time zone unless the `daily` options give a `timeZone`; the screen
   shows the zone the worker reported.

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
     await this.jobs.run(REPORT_JOB, async () => bucketOutcome(await this.cleanup()))
   }
   ```

   `bucketOutcome()` (in `scheduled-job-outcome.ts`) is for a job that runs independent
   steps and collects their failures instead of throwing: no failed step is
   `success`, some failed steps are `partial`, every step failed is `failed`. A job
   with a different shape builds the result itself. `bucketOutcome(result)` takes the
   numeric fields of `result` as `counts` and the names in `result.failures` as `codes`
   (the first 8), and returns `succeeded`, `partial('bucket_failed')` or
   `failed('all_buckets_failed')`. A pass in which nothing was due has all counts at 0 and
   no failures: it is `success`.

   Import `succeeded`, `partial`, `failed` and `skippedFor` from `scheduled-job.ts` and
   `CronExpression` from `@nestjs/schedule`; `daily`, `frequent` and the `EVERY_*`
   constants are in the catalogue file itself.

   Inject `ScheduledJobExecutor` (import `ScheduledJobsModule` in the module that
   provides the service). For a `singleton` job the executor takes the Redis lock
   described by `lock`; your service takes no lock itself. If the lock service cannot
   be asked, the executor records a `lock_unavailable` skip and does not run the task;
   losing the race to another replica is normal and is not recorded. A resolved promise is **not** success: the task must say
   what happened.

The job now appears on the screen. Add `name` and `purpose` under
`console.scheduledJobs.jobs.<id>` in `apps/web/messages/en.json` and every other
catalogue; an id with hyphens is used as it is, for example `"report-cleanup": { "name": ..., "purpose": ... }`
(without them the screen shows the id). A downstream fork with the Console removed needs no change.

## Choose the result

| Return                    | When                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded(summary?)`     | The run reached its end and did its work. Doing nothing because nothing was due is success.                                                                                                                                                                                                                                                                                                                 |
| `partial(code, summary?)` | The run reached its end, but some independent steps failed (buckets, lanes) while others worked. The job continued after the failure.                                                                                                                                                                                                                                                                       |
| `failed(code, summary?)`  | The run stopped because of an error, or every independent step failed so nothing was done. If earlier steps had already committed, put their count in the summary.                                                                                                                                                                                                                                          |
| `skippedFor(reason)`      | Frequent jobs only: `not_ready` (the work cannot start yet, for example the application is still starting), `shutdown` (the process is stopping) or `busy` (another pass or every lane is already taken). The job decides which applies, from its own state: the existing dispatchers use their readiness flag and their lane gate. A skip never makes a job look fresh. Daily jobs must not return a skip. |

### Throw or return

`return failed('code')` ends the run normally: nothing is rethrown. A thrown error is
recorded as `failed` and then rethrown to the scheduler as before, so choose one of
the two. A thrown error carries its class name as the code only when the name is on a
closed list (database, timeout and standard JavaScript error classes); any other name is
recorded as `unexpected`, because a name chosen by a library or by input could carry
content. Return `failed('your_code')` yourself when the Console should show a specific
reason. A resolved result that does not describe the real outcome is a defect: classify
inside the job, at the place that knows, not around it.

### The summary has one shape

The optional `summary` is always `{ counts, codes }`, never a bare object of numbers:

- `counts`: an object of non-negative whole numbers, at most 16 keys.
- `codes`: an array of short codes, at most 8. Use it for failed steps or result codes.
- A key or code starts with a letter and has only letters, digits and `_`, up to 48
  characters. The whole summary is at most 512 bytes.
- Counters and codes only: never an error message, an email address, row content or any
  user data. For diagnosis, log through the project's logging rules (see
  [Observability](../operations/observability.md#structured-logs)): an event name, ids and
  counters, with the redaction the logger already applies. Never copy the message, an email
  address or row content into a log field of your own.

```ts
// A frequent job: finished its pass, checked 12 items. Nothing failed.
return succeeded({ counts: { checked: 12 }, codes: [] })

// Not ready yet or busy: a skip has no summary and never makes the job look fresh.
if (!this.ready) return skippedFor('not_ready')
if (this.busy) return skippedFor('busy')

// Some independent steps failed, the others worked.
return partial('step_failed', { counts: { cleaned: 40 }, codes: ['expiredSessions'] })

// Three transactions committed, the fourth threw and the loop stopped.
return failed('cleanup_aborted', { counts: { committed: 3 }, codes: [] })
```

The Console words a code through its own catalogue; a code it does not know is shown as it
is, so choose readable ids.

Do not record a manual run or a startup attempt as a scheduled run. Call the
shared logic directly, as `POST /admin/cleanup` and the GeoIP startup/CLI path do.

### A job that checks an outside service

When the job's work is to observe a service and store what it saw, a stored negative
observation is a successful run: the job did its work. Return `failed` only when the job
could not do it, for example when the result could not be stored. Otherwise the Scheduled
jobs screen would report the service's outage as a broken job, and "the checker stopped"
would look the same as "the service is down". Put the observed outcome in `codes` and show
the service's health where it belongs, such as an [integration reader](integrations.md).
`telegram-reachability` is the reference: `succeeded` with the observed code, `failed`
(`store_unavailable`, `store_late`, `store_overflow`) when the result was not stored.
The code of a successful frequent run is recorded but not shown on its row, so name the
place of the result in the job's `purpose` copy.

### A job that a configuration switches off

Give the catalogue entry a `disabledReason` (both helpers accept it), for example
`frequent(id, EVERY_MIN, MINUTE, { disabledReason: (env) => (env.get('TOKEN') ? null : 'token_missing') })`.
The worker reports the reason with the job. The decorated method must also return before
`jobs.run(...)` when the configuration is off, so an off job records no run; see
`GeoipUpdateService.scheduledUpdate`.

The catalogue is one list for the whole application. If a feature that owns a job can be
removed, remove its job source and its catalogue entry in the same change.
`test/process-role.e2e-spec.ts` compares the jobs that the worker graph really registers
with the catalogue, so a catalogue entry without its job fails there; the source scan in
`scheduled-jobs.catalogue.spec.ts` fails for a decorated method without its entry.

## What is recorded and how it is judged

- A worker reports the job when its process starts. Each result is merged by the
  start time and run id of the run, so concurrent replicas cannot mix the fields
  of two runs.
- **Daily jobs** keep run history: at most 30 finished runs per job and none older
  than 30 days, plus up to 3 unfinished and 7 abandoned ones. Old rows are removed
  when that job records its next run, not by a separate timer, so a job that no
  longer runs keeps its last rows. The screen shows the latest 20.
  A success moves the due time to the next planned run. Failed, partial and
  skipped runs never move it. A job is `Overdue` when its due time plus
  `graceMs` has passed with no newer success. A run still open after `graceMs` is
  shown as `Result not recorded`.
- **Frequent jobs** keep one summary. A job is `Overdue` when no **successful**
  completed pass was recorded within `staleAfterMs`, which the helper sets to
  `max(10 × period, 5 minutes)`. A job whose every pass fails or is partial becomes
  `Overdue` too. Their current run is not tracked.
- Writing is best-effort and bounded. `begin` and `finish` only update bounded
  in-memory state and return at once, so a slow or unreachable database cannot hold
  a job at its start or its end. One background writer does one write at a time
  (the event lane at most once a second, the summary lane at most once a minute).
  It starts a write only when the pool has an idle connection or can open one
  without making a request wait, and it needs `DATABASE_POOL_MAX` of at least 2. A write that hangs holds that one connection until the pool's
  `DATABASE_QUERY_TIMEOUT_MS` cuts it off, so with a pool of 2 a stuck write takes half of
  the pool for that time (measured: recovery passes were about 50% slower at p95); with a
  pool of 10 the effect on other work was within measurement noise.
  Memory is bounded: at most 3 tracked unfinished runs and 10 run records per job,
  and the newest evidence of each kind per job. A lost write loses an observation,
  never a run. After five failed writes only failures and partial results are kept
  for five minutes.
- Table limits: at most 64 jobs in the catalogue and 2560 run rows in total. Rows of ids
  that are no longer in the catalogue are removed when a worker starts.

Changing a job's schedule, grace or stale threshold changes its config version.
For a daily job, the success recorded under the old schedule stays visible but no
longer sets the due time, which restarts from the new version. A frequent job has no
due time: its last successful pass is judged by the new threshold, even though it ran
under the old one.

## Test it

- `scheduled-jobs.catalogue.spec.ts` is a fast source scan: it fails on a raw
  `@Cron` or `@Interval`, a catalogue entry used other than once, or an inconsistent
  lock or threshold. Run it after adding a job. It reads text, so the authoritative
  guard is `apps/api/test/process-role.e2e-spec.ts`: it runs Nest's own scheduler
  explorer on the real `web`, `worker` and `all` graphs and requires the registered
  jobs to equal the catalogue (each once, with the declared schedule) in worker and
  all, and no scheduler in web.
- `scheduled-job.runtime.spec.ts` shows on the real scheduler that the decorator keeps
  the tick times and the overlap behaviour and that the next planned fire can be read
  when a run starts.
- Unit-test each branch of your result mapping at the place where you classify,
  with `fakeJobs()` from `scheduled-job.test-support.ts`.
- For the write path itself (merge order, caps, concurrency) the PostgreSQL suite is
  `apps/api/test/scheduled-job-evidence.e2e-spec.ts`; the tables under the
  production `migrator` and `runtime` roles are in
  `apps/api/test/scheduled-job-roles.e2e-spec.ts`.
- To measure the recorder's cost against the connection pool, run the on-demand
  `apps/api/test/measure/scheduled-job-overhead.measure.ts`. It is not part of the regular
  suites and `pnpm test:e2e` refuses it. It needs Docker. From `apps/api`, after
  `node ../../scripts/api-e2e-ci.mjs --prepare`:

  ```bash
  NODE_OPTIONS=--experimental-vm-modules node_modules/.bin/jest -c jest-e2e.config.js \
    --testMatch '<rootDir>/test/measure/*.measure.ts' \
    --runTestsByPath test/measure/scheduled-job-overhead.measure.ts
  ```

  Add `--listTests` to check that it is found. Set `DOCKER_HOST` if your container runtime
  is not at `/var/run/docker.sock`.

## Related

- [Deployment](../operations/deployment.md): process roles and why recovery jobs
  run on every replica without a Redis lock.
- [GeoIP setup](../operations/geoip-setup.md): the updater is one such job.
