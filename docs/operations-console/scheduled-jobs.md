# Scheduled jobs

[Operations Console](README.md) → Scheduled jobs

Scheduled jobs shows the results that worker processes recorded for the jobs that
run on a schedule: nightly cleanups, the GeoIP database update and the recovery
passes that run every few seconds. Open it to check that these jobs keep running,
for example when a table grows or a notification is late and you want to know
whether the maintenance job behind it still works. Queues and commands are on
[Background work](background-work.md).

Console access requires a current platform `SUPER_ADMIN`. API keys cannot read
this screen, and an organization role does not grant access. The page is at
`/admin/scheduled-jobs` in path mode and at `/scheduled-jobs` on the Console host,
after the locale prefix (for example `/en/admin/scheduled-jobs`). The screen only
reads: it has no button that starts, stops or edits a job.

## What you see

One row per job (one card per job on a narrow screen). Above the rows, **Data as
of** is the time of the latest successful read, and **Refresh** and
**Auto-refresh** reload this page's data every 30 seconds while the tab is visible
and online. They never change a job.

| Column           | What it tells you                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Job**          | The name and a one-line purpose. A job added by your own code without a translation shows its id.          |
| **Schedule**     | When it runs, in words (**Daily at 02:00**, **Every 30 seconds**), with the time zone the worker reported. |
| **Last result**  | How the latest run that finished ended.                                                                    |
| **Freshness**    | Whether a successful run has happened when one was due.                                                    |
| **Last success** | When the last successful run started, in the display time zone of the header.                              |
| **Took**         | How long the latest finished run took.                                                                     |

Notes under a row explain why it looks the way it does. Jobs that run every
few seconds show only their latest completed pass; a footnote says their current
run is not tracked.

### Read result and freshness separately

They answer different questions, so a job can show both **Partly done** and
**Overdue**.

| Last result             | Meaning                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Success**             | The run finished and did its work. Doing nothing because nothing was due also counts.                                   |
| **Partly done**         | The run reached its end but some steps failed. The note names them. A partly done run does not count as a success.      |
| **Failed**              | The run stopped with an error, or every one of its steps failed. The note gives a short reason, never an error message. |
| **Running**             | A daily job's run started recently and has not finished.                                                                |
| **Result not recorded** | A run started, but nobody recorded its end. The worker may have stopped. This is not a failure and not a success.       |
| **No runs yet**         | No run has been recorded since a worker first reported the job.                                                         |

| Freshness      | Meaning                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On time**    | A success has been recorded for the latest due time, or the next one is not due yet.                                                                                                                                |
| **Overdue**    | No success was recorded by the time one was due plus a grace period (30 minutes for daily jobs). For jobs that run every few seconds: no successful pass for 5 minutes (10 minutes for jobs that run every minute). |
| **Not known**  | Nobody has reported the job, so there is nothing to judge.                                                                                                                                                          |
| **Turned off** | A worker reported the job as turned off by configuration, for example GeoIP when `GEOIP_ENABLED` is `false`. The note says why.                                                                                     |

**Overdue** means no fresh confirmation was recorded. It does not prove the
job stopped: a pass that takes unusually long also shows it.

A **skipped** run appears as a note (**Last skipped run: …**) only when it is newer
than the result shown. It never makes a job look fresh. The reasons are: the lock
service could not be reached, the process was not ready, the process was shutting
down, or all workers were busy. A replica that lost the race for a nightly job's
lock is normal and is not recorded.

## Run history

Daily jobs have **Run history**. Open it to see up to the latest 20 runs with their
start, end, duration, result and what the run counted (for example _expired
sessions: 12_). An open history is refreshed together with the page; if that fails,
it keeps the older runs and says when they were read. Per job, the page keeps at most
30 finished runs, none older than 30 days, and a few unfinished ones. Old runs are
removed when that job records its next run, so a job that no longer runs keeps its
last rows. Jobs that run every few seconds have no history: their row is a summary of
the latest completed pass.

## What to do

1. **Overdue, last result Failed or Partly done.** The job ran and did not
   complete. Read the note and the history, then search the worker logs around the
   run time.
2. **Overdue, last result Success, Failed or No runs yet.** No success was recorded
   in time. This does not prove the job did not run. Check, in this order: that a
   worker process is running (see the process roles in
   [Deployment](../operations/deployment.md)); that it can reach the database; whether
   an earlier run is still working, because a long run holds the job's lock; and
   whether the row's note says observations were lost, which means results could not
   be written. Search the worker logs around the due time before you conclude that
   it did not start.
3. **Result not recorded.** Check whether a worker restarted around the start time.
   A nightly job that never finishes can also hold its lock for up to 30 minutes.
4. **No worker has reported these jobs yet** (banner). Start a worker, or check
   its database connection. Also check `DATABASE_POOL_MAX`: with a pool of one a
   worker records nothing, not even its first report, so a new installation stays
   in this state until the pool is at least two. The page shows the jobs of the code catalogue, so the
   absence of rows is never a sign of "no jobs".
5. **Turned off.** The job is switched off by configuration. Change the setting
   in the [environment](../operations/geoip-setup.md) if it should run.

## What this page does not tell you

- It does not start, retry or schedule anything. Manual runs are not part of this
  screen; the `POST /admin/cleanup` operation is separate and is not recorded as
  a scheduled run.
- It reports what workers recorded. If several replicas run a job, a success on
  any replica counts; the page does not show each replica.
- It does not promise that a job will run again.
- Cleanup and retention results count rows, not outcomes for users. Whether a
  notification was delivered or an AI run finished is on
  [Background work](background-work.md).
- The GeoIP database update records only its scheduled run. The startup attempt
  and the operator command are not recorded.

## When the database is slow or small

Workers record results in the background. A job does not wait for the database to
start or to finish, so a slow or unreachable database can delay or lose a record
but does not hold a job at its start or end. A worker writes only when the
connection pool has a free connection and does not make a request wait for one.
After repeated failed writes a worker keeps only failures and partly done runs
for five minutes. The row's note says when observations were lost under load.
Recording needs a database pool of at least two connections
(`DATABASE_POOL_MAX`); with a pool of one it is switched off. Existing records
stay and age normally: a job that last succeeded before the change keeps that
success and becomes **Overdue** when its next success is due, because nothing newer
can be recorded. A read failure of this page shows an error, never an empty
list.

Each job's schedule time zone is the one the worker's process uses (GeoIP is
always UTC). The header's **Time** selector changes only how dates on this page
are displayed.

## For developers

To make your own periodic job appear here, register it once. See
[Scheduled jobs for developers](../backend/scheduled-jobs.md). The Console adds no
page, API or permission for it.
