# Background work

[Operations Console](README.md) → Background work

Background work shows what is waiting in the application's background queues:
emails to send, wake-up signals for notifications and AI runs, and any queue your
own code adds. Open it when something feels late, for example "emails are slow",
and you want to know whether work is piling up, stuck behind a pause, or cannot
be read at all. Registered work also exposes safe job diagnostics and the actions
its policy supports: pause, resume, retry, cancel and cleanup. Unsupported actions
show a reason. The [queue board](queue-board.md) remains read-only; controlled
actions belong to the native Console.

Console access requires a current platform `SUPER_ADMIN`. API keys cannot read
this screen, and an organization role does not grant access. The page is at
`/admin/background-work` in path mode and at `/background-work` on the Console
host, after the locale prefix (for example `/en/admin/background-work`).

## What you see

The page starts with shared Refresh, Auto-refresh and read-only Bull Board actions.
Queue overview appears first, followed by Task management. The overview counts
broker queues; management lists registered kinds of work, including DB-owned work
without a broker queue. Different row/card counts are therefore expected.
Readable queue and work names come from the same backend registration; technical
queue/work IDs remain visible for diagnostics.

Each queue is one row on a wide screen and one card on a narrow one. The page
header shows the latest successful overview read. Shared refresh also reads the
work catalogue and any open task list, preserving filters and captured selection.
If a section fails, its older data and error remain visible and a page-level
partial-refresh notice explains that the timestamp does not certify that section.
The status icon describes data availability, not worker activity.

| Column            | What it means                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue             | A readable name, the technical name (for example `email`), and what the queue is for.                                                                                                                                                                                                             |
| State             | **Paused** or **Not paused**. A queue with nothing in it also says **Empty**. A queue that could not be read says **Unavailable**.                                                                                                                                                                |
| Waiting           | Jobs ready to run but not yet taken. This includes jobs with a priority.                                                                                                                                                                                                                          |
| Active            | Jobs a worker is running right now.                                                                                                                                                                                                                                                               |
| Delayed           | Jobs scheduled for later, including jobs waiting to be retried. Delayed work is normal and not a problem on its own.                                                                                                                                                                              |
| Failed            | Failed jobs that are still kept. A queue trims old failures by age and count (by default the last 1,000, for 24 hours), but only when other jobs finish, so a quiet queue can keep older ones, and a job can carry its own setting. This is not a lifetime total and not a strict 24-hour window. |
| Oldest queued job | How long ago the oldest queued job was created, rounded down, shown as "At least …". It is a lower bound, not the time the job has been waiting.                                                                                                                                                  |

A dash means "not measured". Nothing is ever shown as zero when the queue could
not be read.

### The queues that ship with the starter

| Queue           | Kind   | What an empty queue means                                                                                                                          |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`         | Work   | No email waits to be sent. Messages that contain secret links (password reset, verification, invitations) are sent directly and never appear here. |
| `notifications` | Wake   | Only wake-up signals live here. The real delivery state is stored in the database, so an empty queue does **not** mean nothing is pending.         |
| `ai-runs`       | Wake   | Only wake-up signals live here. Run state is stored in the database, so an empty queue does **not** mean nothing is pending.                       |
| `default`       | Custom | Observed external queue with no managed worker. Native commands are disabled; downstream processing requires a supported work registration.        |

A queue added by your team appears with its technical name and a generic
description for its kind. See [Adding a queue](#adding-a-queue-for-developers).

## States

| State       | Meaning                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not paused  | The queue has no global pause flag. This does **not** prove a worker is running (the screen cannot see workers), and it says nothing about whether new jobs are being added.                                                   |
| Paused      | A pause flag is set on the queue, on purpose or by mistake. Jobs can still be added and are counted under **Waiting**, but workers do not take new ones until the queue is resumed. A job a worker already started may finish. |
| Empty       | Nothing is waiting, running, delayed or waiting on child jobs. Kept failures do not count. Empty is separate from paused and unavailable.                                                                                      |
| Unavailable | The numbers could not be read in time (Redis down or too slow). This is **not** an empty queue.                                                                                                                                |
| Disabled    | This deployment switched the queue off in its queue list. Nothing is read for it.                                                                                                                                              |

If no queue can be read, a notice above the list says so. Every row still shows its own **Unavailable** state.

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
- A hidden tab does not refresh itself. When you come back, the page refreshes if
  its data is due for refresh and auto-refresh is on, you are online, and any wait
  after a failure or rate limit has ended. A refresh you started yourself may
  finish while the tab is hidden.
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

| You see                                                  | Likely meaning and what to do                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting grows, **Not paused**, Active stays at 0         | No worker is taking jobs. Check that the worker process (or the `all` role) is running. See the [queue runbook](../operations/runbooks/queues.md#backlog).                                                                                                                      |
| **Paused** and Waiting is above 0                        | The queue was paused. Confirm that was intended, then resume it by the controlled way described in the [queue runbook](../operations/runbooks/queues.md#paused).                                                                                                                |
| Waiting is high but Active is also high                  | Workers are busy. Watch whether the "Oldest queued job" keeps growing.                                                                                                                                                                                                          |
| **Failed** is above 0                                    | For registered work, use **Inspect jobs**, select **Failed**, and read **Reason for failure** and **What to do**. If the reason is unavailable, ask the maintainer to inspect protected worker diagnostics. See the [email runbook](../operations/runbooks/email.md) for email. |
| A row says **Unavailable**                               | The queue's numbers could not be read in time. Redis being down or slow is the usual cause, but not the only one. Use **Refresh**; if it persists, check the API logs and the [Redis runbook](../operations/runbooks/redis.md).                                                 |
| Every row says **Unavailable**                           | No queue could be read. Nothing is known about the queues right now. Check Redis, the API and its logs.                                                                                                                                                                         |
| `notifications` or `ai-runs` is **Empty** but users wait | Look in the database state, not here. These queues only wake workers.                                                                                                                                                                                                           |

If the whole page shows "temporarily unavailable", the API could not be reached
at all, or the session check could not complete. Use **Retry**.

For queues without supported native job inspection, use the read-only
[queue board](queue-board.md) and ask the maintainer to inspect protected worker diagnostics.
Notification and AI wake queues do not describe their database-owned business work;
inspect that domain's state instead.

## Failure diagnostics

Native diagnostics currently show failed state, attempt information and policy
refusal codes. For a failed task, **Reason for failure** shows the developer's registered safe
explanation; **What to do** shows its recommended next step. For example, an image
handler can explain that a file is invalid and ask you to upload a valid image,
or explain that storage is unavailable and ask you to check it before retrying.
These explanations appear automatically for registered work without a separate
admin screen. They do not confirm that another attempt will succeed.

Unexpected errors, unknown codes, lost reports and expired history show that the
detailed reason is unavailable. Ask the service maintainer to inspect protected
worker diagnostics. The Console never returns raw exceptions, secret URLs,
provider responses or stack traces. A payload field label is not a failure cause.
After retry/new start, an old failure is not shown as the current result. External
**Outcome unknown** remains unknown regardless of a diagnostic explanation.
Real notification and AI failure mappings are provided by their domain adapters;
the demonstration image recipe stores a reference rather than decoding a real file.
The queue board also hides raw failure messages.

## Privacy and security

The queue overview shows counts, a pause flag and an age. Native job diagnostics
show job identity/incarnation, names, safe registered scalar projections, finite
attempt/grant information and policy refusal codes. They omit arbitrary payloads,
provider responses, secret links, frozen email bodies and Redis keys. The browser
talks only to the Console's own server, which holds
the credentials; the browser never receives an API token.

The [queue board](queue-board.md) that this screen links to is a separate, view-only page
that does show job ids, names and times, and a reviewed part of some payloads. Its
[data rules](queue-board.md#what-the-board-shows) are separate from this screen's promise.

## Queue board entry

Use native **Inspect jobs** for supported registered work and its permitted actions.
The queue board supplements this view with read-only broker diagnostics.
Its entry depends on what the API confirmed in the latest reading:

- **Open queue board** sits with the page actions (next to Auto-refresh and Refresh), with a help
  icon that explains what the board does not allow. Every queue that has a board page also has
  **Open in queue board**. Both open in a new tab.
- **Queue board is not enabled**: the board was not mounted when the API started, with the steps
  to enable it ([Enabling the board](queue-board.md#enabling-the-board)). The button and row links
  are not shown.
- **Could not open the queue board**: the last attempt to open it failed while the board is
  available now; the button stays. It disappears when you try again or when the board's state
  changes.

While your access is being re-verified no board entry is shown.

## Adding a queue (for developers)

Use the [backend registration recipe](../backend/background-work.md). One
registration connects observation, diagnostics and permitted commands to this
Console. No per-work admin controller, BFF, page, permissions, confirmation or
audit implementation is required. Generic technical names work without new
translations; localized titles/descriptions are optional presentation changes.

The registration's queue `enabled: false` skips its queue and worker bindings;
its managed producer refuses additions. The catalogue retains a disabled entry.
An external queue has observation without managed business execution or job commands.

## Work control cards

Each work card uses the standard Console widget surface. Its upper-right icon
and text describe data access, not worker health: **Data available**, **Data
unavailable**, or **Disabled**. The muted line immediately below identifies where the data is stored.
A successful reading does not establish that every job succeeds or every action
is supported. Unavailable data is never treated as an empty queue.

**Queue jobs** reads state from the background queue. **Jobs in the database**
reads the business work records; a queue may only signal when to process them.
The help icons explain these sources and the meaning of pause without requiring
knowledge of the queue implementation.

**Queue-wide pause is not supported** is a capability restriction, not an error.
Unsupported pause/resume controls are omitted. A supported action stays visible
when temporarily blocked, with its refusal reason. Individual job actions remain
policy-dependent.
Queue cards show one available direction of control: **Pause** while not paused,
and **Resume** while paused, with a pause/play icon. The state changes after a
fresh server observation; busy or policy-blocked actions remain disabled. When
the pause state is unknown, the Console does not guess which action to offer.

## Controlled actions

Open **Inspect jobs** on the work you want to examine. The selected button is
highlighted and focus moves to its **Jobs** card. The card uses the same surface
as other Console widgets. Select a state to filter the list; the highlighted
filter identifies the current view. These filters do not change jobs. Previous
and Next move through the bounded live window, not a complete historical archive.

**Not paused** means the queue is not paused; it does not prove a worker
is running. **Paused** prevents workers taking another job,
while already active work can finish and the application can continue adding jobs.
Some kinds of work do not support queue-wide pause/resume; this is a capability
restriction, not a fault. Individual job actions are also policy-dependent.

Choose eligible jobs. The batch action buttons appear after you select a job.
When there is only one available page, pagination is hidden. While a job list
is loading, its card shows a structural skeleton; an empty result uses the
standard no-results state. Selection captures
their identities and revisions; a later refresh does not replace the selection.
Choose an action, review the captured targets and enter a reason. Cleanup also
requires terminal states and a cutoff. When prompted, confirm recent personal
authentication. A changed target is refused rather than silently recaptured.

- **Pause/resume** changes new worker claims. Producers may keep adding jobs and
  active jobs may finish. Queue backlog size does not prevent these actions:
  the4096-entry membership limit applies to job actions, not queue pause/resume.
- **Retry** is a policy-approved extra attempt, not an unlimited retry loop.
  Ordinary managed work has one lifetime manual grant per incarnation.
  Idempotent handlers own durable business deduplication. Queued email additionally
  requires a supported transient no-effect result, the same immutable request,
  provider scope and key, a satisfied cooldown and the original provider horizon.
  Unknown or accepted delivery is not manually retryable.
- **Cancel** removes supported unstarted work. It does not interrupt an active
  business effect or promise to undo delivery.
- **Cleanup** removes eligible old terminal job history. It does not delete
  business deduplication records, command receipts, audit or protected uncertainty.

A fully applied action closes the confirmation, shows a success toast and refreshes
page data. Retry success means the task was queued for another attempt, not that
its business processing succeeded. A refusal remains in the confirmation with
its explanation. Partial or unconfirmed results remain in a result dialog, never
in an extra page block. Closing that dialog retains the command address and a
**Read receipt** action; reopening or reloading reads the same result without
reposting the command. A toast retains the original command ID even if you perform
another action before opening it. Page/section errors describe read availability separately.

The receipt reports each target separately. A batch can partially apply; already
applied targets are not rolled back because a later target was stale. Keep its
command ID. Reloading or navigating receipt history reads the receipt and does not
send the command again. After an ambiguous response, inspect that receipt instead
of creating another command to repeat the presumed action.

An operator can issue an immediate burst of3 commands; the shared PG budget
replenishes at10 commands per minute. Pause/resume has the same actor burst/rate.
A429 response includes `Retry-After`: wait for that interval before preparing a
new confirmation after a definitive admission refusal. Do not use a rate-limit
response or a transport failure as evidence that an earlier command was undone.
Keep its command ID and read the receipt when the response was ambiguous.
The [backend limits](../backend/background-work.md#limits-and-deployment) describe
the separate read/target budgets and active reservations.

## Unknown results and recovery

An unknown command is not proof of success or failure. It remains protected and
is never automatically redispatched. Conflicting administrative effects are
blocked until settlement and an explicit disposition. Inspect business/worker
logs, then use the receipt's uncertainty form with a reason and optional bounded
incident references. The server rechecks personal authority, captured revision
and the ordinary Redis settlement barrier. Clock uncertainty or an unexpired
dispatch prevents disposition. Durable work uses its PG authority.

Acknowledging uncertainty keeps the original result unknown and retains its
protected capacity. It releases administrative conflict/execution reservations;
it does not restore spent attempts, mint a retry grant or establish delivery
certainty. New commands must still pass current business policy.

For queued email, choose **Retained evidence** to inspect independent PG evidence
even after stock job trimming or broker failure. The same job ID can have multiple
incarnations. Broker state and completion counts are explicitly unobserved on
this source; no queue job can be selected for mutation there. A recorded unknown
effect has a separate disposition. An active/unrecorded attempt remains protected
until its immutable horizon is certainly past. Its disposition retains attempt
markers, certainty, grants, fence and all unresolved/row reservations.

Diagnostics cover a live first512-identity window with pages of1–50, not a complete
archive. Job commands refuse unsupported primary-list membership above4096.
Queue pause/resume still works on a supported large layout. A mixed legacy
wait/paused-list layout requires explicit maintenance migration with producers
and workers stopped; Console refusal makes no writes and does not perform a
partial resume. Never repeatedly call stock resume as operator recovery.

Storage-limit refusal preserves existing evidence. Read diagnostics and resolve
incidents; acknowledgement cannot delete unknown evidence to manufacture capacity.
See [capacity and retention](../backend/background-work.md#retained-uncertainty-and-capacity)
for compiled numerical bounds and DB sizing.

## API

Registered work uses `/api/v1/admin/background-work/works`, bounded job reads,
`commands` and retained command receipts. Command reconciliation and provider
evidence reconciliation are separate fixed metadata routes. POST input is capped
at32KiB; receipts have a separate128KiB response ceiling. Exact DTOs, status codes
and route inventory are documented by generated OpenAPI at `/docs`.

The queue overview also reads `GET /api/v1/admin/background-work/queues`. It requires a
current `SUPER_ADMIN` bearer token, rejects API keys (401), answers 403 to other
users and 429 when rate-limited, and sends `Cache-Control: private, no-store`.
The path is deliberately not under `/admin/queues`, which belongs to the Bull
Board dashboard. The schema is in the generated OpenAPI document at `/docs`.

An observed Redis problem is part of a normal 200 response, never an error:

```json
{
  "checkedAt": "2026-10-03T12:00:00.000Z",
  "board": { "state": "available" },
  "queues": [
    {
      "name": "email",
      "kind": "work",
      "inBoard": true,
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
    { "name": "ai-runs", "kind": "wake", "inBoard": true, "status": "unavailable" },
    { "name": "default", "kind": "extension", "inBoard": false, "status": "disabled" }
  ]
}
```

`board.state` is `available` or `disabled`. `disabled` means one confirmed thing: the queue
board was not mounted when the API started (production without `ENABLE_BULL_BOARD=true` in the
process environment). `inBoard` says that the queue has a page in the board (true for every enabled queue); it does not say
that the board is on, so the screen offers a link only when both hold.

`counts.waiting` and `counts.prioritized` are separate fields; the screen's
**Waiting** is their sum. `age.status` is `sample`, `none` (nothing queued) or
`unknown` (jobs are queued but no timestamp could be read). The same numbers are
also exported as Prometheus metrics by worker processes; see the
[observability guide](../operations/observability.md#metric-families).

### Job cards and selected actions

The highlighted state filter identifies the list; matching cards do not repeat
that state. A different observed state or a retained provider record remains
explicit, since it is not evidence of the selected queue state. The view does not
offer a combined All filter. Names and safe field labels come from the work
registration, with English fallback; technical work IDs remain visible.

Unavailable actions appear in one wrapping row per card. Each help icon explains
that job’s restriction. Selecting jobs keeps the captured identities and
revisions; refresh does not silently replace that selection. If no action is
allowed for the whole selection, a message replaces the three disabled buttons.
During command submission the controls remain present and disabled.

Provider acceptance means the external service accepted the request, not that
delivery or processing finished. An unknown outcome may already have produced
an effect; repeating it may create a duplicate. A result that was not saved is
reported separately from a confirmed absence of an effect.

### Action confirmations

Confirmations explain retry, cancellation, cleanup, pause and resume separately.
They show the registered work name and approved field labels. Work/job IDs have
the same copy control as other Console details. Captured versions and execution
identities are available under Technical details; they still travel in the
command and remain part of stale-state validation.

Each job has one manual retry, separate from automatic attempts. A retry that
has already been requested remains unavailable while its grant is reserved; a
spent grant cannot authorize another manual start. Never create a replacement
command when the previous administrative outcome is unknown.

The required reason is an operator explanation recorded in strict audit. It
does not change execution parameters. For example, describe the corrected
configuration before retrying or the maintenance before pausing.

Action confirmations remain open while submitting and show request failures in
place, preserving the operator reason. A definitive admission denial has no saved
result and does not create a receipt URL or trigger receipt reads. An uncertain
transport outcome retains the same command identity and reads its result; it does
not resend the command. Action result distinguishes missing/unreadable receipts
from active reads, and does not claim a 404 proves that an uncertain action failed.
Technical request IDs remain copyable in collapsed details.

Cleanup removes selected terminal task records, not individual attempts within
a task and not business output. Its optional operator time restriction lives
under Additional restrictions; the default excludes records completed in the
last24 hours. Mandatory registration retention and safety checks always apply.
Cleanup uses a date/time input in the displayed Console time zone, captured
when the confirmation opens. The API still receives an exact UTC instant.
Nonexistent or ambiguous local times are rejected. The cutoff checks completion
time for each selected record, in addition to mandatory retention and safety
predicates; cleanup does not delete business output.
