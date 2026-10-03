# Background work

[Operations Console](README.md) → Background work

Background work shows what is waiting in the application's background queues:
emails to send, wake-up signals for notifications and AI runs, and any queue your
own code adds. Open it when something feels late, for example "emails are slow",
and you want to know whether work is piling up, stuck behind a pause, or cannot
be read at all. The screen is read-only. It cannot pause, resume, retry or delete
anything, and it never shows what a job contains.

Console access requires a current platform `SUPER_ADMIN`. API keys cannot read
this screen, and an organization role does not grant access. The page is at
`/admin/background-work` in path mode and at `/background-work` on the Console
host, after the locale prefix (for example `/en/admin/background-work`).

## What you see

Each queue is one row on a wide screen and one card on a narrow one. The page
header shows the time the data was read.

| Column            | What it means                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue             | A readable name, the technical name (for example `email`), and what the queue is for.                                                                       |
| State             | **Paused** or **Not paused**. A queue with nothing in it also says **Empty**. A queue that could not be read says **Unavailable**.                          |
| Waiting           | Jobs ready to run but not yet taken. This includes jobs with a priority.                                                                                    |
| Active            | Jobs a worker is running right now.                                                                                                                         |
| Delayed           | Jobs scheduled for later, including jobs waiting to be retried. Delayed work is normal and not a problem on its own.                                        |
| Failed            | Failed jobs that are still kept. By default a queue keeps only the most recent failures (up to 1,000, for up to 24 hours), so this is not a lifetime total. |
| Oldest queued job | How long ago the oldest queued job was created, rounded down, shown as "At least …". It is a lower bound, not the time the job has been waiting.            |

A dash means "not measured". Nothing is ever shown as zero when the queue could
not be read.

### The queues that ship with the starter

| Queue           | Kind   | What an empty queue means                                                                                                                          |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`         | Work   | No email waits to be sent. Messages that contain secret links (password reset, verification, invitations) are sent directly and never appear here. |
| `notifications` | Wake   | Only wake-up signals live here. The real delivery state is stored in the database, so an empty queue does **not** mean nothing is pending.         |
| `ai-runs`       | Wake   | Only wake-up signals live here. Run state is stored in the database, so an empty queue does **not** mean nothing is pending.                       |
| `default`       | Custom | An empty queue for your own code. The starter has no worker for it, so jobs you add wait until you add a processor.                                |

A queue added by your team appears with its technical name and a generic
description for its kind. See [Adding a queue](#adding-a-queue-for-developers).

## States

| State       | Meaning                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Not paused  | The queue is accepting work. This does **not** prove a worker is running: the screen cannot see workers.                                  |
| Paused      | Someone paused the queue on purpose or by mistake. Jobs stay under **Waiting** and are not processed until the queue is resumed.          |
| Empty       | Nothing is waiting, running, delayed or waiting on child jobs. Kept failures do not count. Empty is separate from paused and unavailable. |
| Unavailable | The numbers could not be read in time (Redis down or too slow). This is **not** an empty queue.                                           |
| Disabled    | This deployment switched the queue off in its queue list. Nothing is read for it.                                                         |

If no queue can be read, one notice says so instead of repeating it on every row.

## Refreshing

The page loads with the latest data already in place. After that it refreshes
itself about every 30 seconds while the browser tab is visible and online.

- **Auto-refresh: on / paused** turns the automatic refresh off and on. It does
  not touch any queue. It is on every time you open the page.
- **Refresh** reads once more right away. It also works while auto-refresh is
  paused. It is disabled while a read is running and while you are offline.
- If a refresh fails, the previous rows stay on screen with a note giving the
  time of that data and saying the last refresh failed. Old data is never shown
  as fresh.
- After a failed refresh, or while every queue stays unreadable, automatic
  refresh waits longer: 30 seconds, then 60, 120, 240 and at most 300 seconds. A
  rate-limit answer is honoured: **Refresh** shows when it is available again.
- A hidden tab does not refresh. When you come back, the page refreshes once.
- If your Console access ends (for example your role was changed), the rows
  disappear immediately and the page checks your access again.

The time at the top is the time of the last successful read in your selected
Console time zone. See [the display time zone](README.md#display-time-zone).

## What this screen does not tell you

- **Whether workers are running.** It shows where work waits. A queue can be
  "Not paused" with a growing Waiting count because no worker is running.
- **The state of notifications and AI runs.** Their queues only carry wake-up
  signals; the real work is stored in the database.
- **One server or the whole fleet.** The numbers come from the queues in the
  Redis configured for this API, which every API and worker process shares.
- **An exact oldest job.** The age comes from a small sample taken at the front
  of the queue. A job that was retried, scheduled earlier or given a priority can
  be older than the sample shows.
- **One moment in time.** Counts, the pause flag and the age are read a few
  milliseconds apart, not in a single atomic step.

## Reading the screen

| You see                                                  | Likely meaning and what to do                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting grows, **Not paused**, Active stays at 0         | No worker is taking jobs. Check that the worker process (or the `all` role) is running. See the [queue runbook](../operations/runbooks/queues.md#backlog).       |
| **Paused** and Waiting is above 0                        | The queue was paused. Confirm that was intended, then resume it by the controlled way described in the [queue runbook](../operations/runbooks/queues.md#paused). |
| Waiting is high but Active is also high                  | Workers are busy. Watch whether the "Oldest queued job" keeps growing.                                                                                           |
| **Failed** is above 0                                    | Jobs failed and are kept. Look at the worker logs for the cause; see the [email runbook](../operations/runbooks/email.md) for email.                             |
| A row says **Unavailable**                               | Redis did not answer in time. Use **Refresh**; if it persists, follow the [Redis runbook](../operations/runbooks/redis.md).                                      |
| Every row says **Unavailable**                           | Redis cannot be reached from the API. Nothing is known about the queues. Check Redis and the API.                                                                |
| `notifications` or `ai-runs` is **Empty** but users wait | Look in the database state, not here. These queues only wake workers.                                                                                            |

If the whole page shows "temporarily unavailable", the API could not be reached
at all, or the session check could not complete. Use **Retry**.

## Privacy and security

The screen shows counts, a pause flag and an age. It never shows job contents,
job IDs, job names, error messages or Redis keys. It reads queue state without
writing anything. The browser talks only to the Console's own server, which holds
the credentials; the browser never receives an API token.

## Adding a queue (for developers)

Queues come from one list in code, not from scanning Redis. To add one, add its
name to `QueueName`, then add its description to the queue inventory, as the
[queue guide](../../apps/api/src/infrastructure/queue/README.md#adding-a-queue)
explains. After that it is registered, counted in the metrics and shown here,
with generic text until you add a name and description to the Console messages
(`console.backgroundWork.queues` in `apps/web/messages/*.json`).

A test fails if code creates a queue outside that list, so a queue cannot be
added by accident and then stay invisible here.

Setting `enabled: false` for a queue switches off its registration and reading,
and the screen shows **Disabled**. It does not remove the code that sends jobs to
the queue or the worker that processes them: only `default` can be switched off
by the flag alone. See
[Disabling a queue](../../apps/api/src/infrastructure/queue/README.md#disabling-a-queue).

## API

The screen reads `GET /api/v1/admin/background-work/queues`. It requires a
current `SUPER_ADMIN` bearer token, rejects API keys (401), answers 403 to other
users and 429 when rate-limited, and sends `Cache-Control: private, no-store`.
The path is deliberately not under `/admin/queues`, which belongs to the Bull
Board dashboard. The schema is in the generated OpenAPI document at `/docs`.

An observed Redis problem is part of a normal 200 response, never an error:

```json
{
  "checkedAt": "2026-10-03T12:00:00.000Z",
  "queues": [
    {
      "name": "email",
      "kind": "work",
      "status": "available",
      "sampledAt": "2026-10-03T12:00:00.000Z",
      "paused": false,
      "counts": {
        "waiting": 12,
        "prioritized": 2,
        "active": 2,
        "delayed": 0,
        "failed": 3,
        "waitingChildren": 0
      },
      "age": { "status": "sample", "seconds": 245, "sampled": 14 }
    },
    { "name": "ai-runs", "kind": "wake", "status": "unavailable" },
    { "name": "default", "kind": "extension", "status": "disabled" }
  ]
}
```

`counts.waiting` and `counts.prioritized` are separate fields; the screen's
**Waiting** is their sum. `age.status` is `sample`, `none` (nothing queued) or
`unknown` (jobs are queued but no timestamp could be read). The same numbers are
also exported as Prometheus metrics by worker processes; see the
[observability guide](../operations/observability.md#metric-families).
