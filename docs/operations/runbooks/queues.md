# Queue runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-queues` group.
These alerts can be suppressed by the Redis inhibition rule in
`docker/monitoring/alertmanager/alertmanager.yml` — if `AMCoreRedisReconnectingPage`
(see [`redis.md`](redis.md#reconnecting)) is also firing, check that first;
these alerts being silent does not mean the backlog is fine.

To see the current state of every queue (waiting, active, delayed, failed, paused,
and a sampled age of the oldest queued job) without a metrics query, open the Operations
Console's [Background work](../../operations-console/background-work.md) screen. It
provides safe diagnostics and policy-eligible commands with captured confirmations
and audited receipts. Bull Board remains read-only. It shows `notifications` and `ai-runs` as wake queues: their real
backlog is in the database, as described under [Outbox backlog](#outbox-backlog).
The separate `notification-deliveries` card shows this durable backlog. Pausing it
blocks future claims; already claimed work may drain. Retry reserves one lifetime
attempt and retains the provider floor. Unknown sending history refuses retry and
cleanup. See [delivery control](../../notifications/control.md).

## Backlog

**Symptom:** `AMCoreQueueBacklogTicket` (>100 waiting jobs in `email`/`default`
for 30m) or `AMCoreQueueBacklogPage` (>1000 for 15m) is firing. Both already
gate on the queue not being deliberately paused
(`amcore_queue_paused{queue=...} == 0`) — see [Paused](#paused) below.

**Possible causes:**

1. Worker throughput has genuinely dropped (fewer worker replicas, worker
   crash-looping, or a slow downstream dependency the job handlers call into).
2. Producer rate has spiked well beyond normal (a legitimate traffic surge,
   or a bug producing duplicate/excess jobs).
3. A dependency the job handler needs (DB, an external API) is failing, so
   jobs fail and retry instead of completing, inflating `waiting` behind the
   retry backoff.

**Diagnostic steps:**

1. Query directly, per queue:

   ```promql
   amcore_queue_jobs{queue=~"email|default",state="waiting"}
   ```

2. Open the **"Queue jobs by state"** dashboard panel (Queues & outbox row) to
   see the full state breakdown (`waiting`/`active`/`delayed`/`failed`/etc.) —
   a healthy producer surge shows `active` keeping pace with `waiting`; a
   worker-throughput problem shows `active` flat or falling while `waiting`
   climbs.
3. Check the `worker`/`all` process replicas and health. For the shipped `default`
   queue, first confirm that the product registered a business worker: the starter
   only observes this external queue. More stock worker replicas do not add its
   missing handler.
4. If handler failures are suspected, check [Dead-letter](#dead-letter) below
   for a correlated rise in dead-lettered jobs on the same queue.

**Mitigation:**

- If worker throughput dropped: restore worker replica count, or restart
  crash-looping workers.
- If producer rate spiked legitimately: scale worker replicas to match, or
  accept the backlog will drain once the surge subsides (verify this is
  actually a transient surge, not a sustained new baseline, before assuming
  it will self-resolve).
- If a downstream dependency is failing: mitigate that dependency (see
  [`db.md`](db.md) or [`redis.md`](redis.md)); jobs should drain once handlers
  can complete again.

**Escalation:** `Ticket` (more than 100 waiting for 30m) is worth investigating
before it grows. `Page` (more than 1000 waiting for 15m) means user-facing delivery is
meaningfully delayed for the `email`/`default` queue — escalate per your
organization's on-call process.

## Paused

**Symptom:** `AMCoreQueuePausedUnexpected` is firing (`{{ $labels.queue }}`
has been paused for at least a minute).

**Possible causes:**

1. Someone paused the queue deliberately through the shared control API (the queue
   board is view-only and cannot pause) and this alert is a confirmation, not a
   surprise.
2. The pause was accidental (a script or manual action targeting the wrong
   queue).
3. An automated process paused it as a safety measure and the underlying
   condition that triggered the pause hasn't been addressed yet.

**Diagnostic steps:**

1. Query directly to confirm which queue and since when:

   ```promql
   amcore_queue_paused == 1
   ```

2. Check the command receipt and audit for the actor, reason and outcome, then
   correlate your team's deploy/change history. The read-only queue board shows
   the pause flag but does not establish who changed it.
3. Open the **"Queue paused"** dashboard panel (Queues & outbox row) to see
   the pause duration and whether other queues are affected too.

**Mitigation:**

- If deliberate and still needed: no action — this alert exists precisely so
  an intentional pause doesn't go unnoticed as "delivery silently stopped."
- If accidental or no longer needed: use the shared background-work control API
  with the current captured epoch/revision and a reason. Queue pause/resume remains
  available for supported modern queues regardless of backlog size. Job actions
  retain their bounded membership limits. Mixed legacy layouts refuse without
  writes and require a controlled migration; do not merge lists with raw commands.
  The queue board cannot resume
  a queue, and no setting makes it able to.

**Escalation:** this is `severity: page` specifically because a paused queue
is silent, user-facing delivery stop if it wasn't deliberate — treat every
occurrence as needing a human confirmation of intent, even if it turns out to
be a non-event.

## Outbox backlog

**Symptom:** `AMCoreOutboxBacklogTicket` (due-now gauge above 50 for 30m) or
`AMCoreOutboxBacklogPage` (above 500 for 15m) is firing, for either the
`notifications` or `ai-runs` source (`{{ $labels.source }}`).

**Possible causes:**

1. The dispatcher for that source is falling behind real load.
2. The metrics collector for the underlying gauge (`amcore_notification_delivery_due`
   or `amcore_ai_run_due`) has stalled — since both are zero-label gauges, a
   stalled collector reads back as `0`, not absence, so it can look like "no
   backlog" when the true state is unknown. Always check
   `AMCoreMetricsCollectorErrors` first (see
   [`metrics-collector-health.md#collector-errors`](metrics-collector-health.md#collector-errors))
   before trusting a low reading here.
3. The `notifications` or `ai-runs` wake path is stalled. These BullMQ jobs
   are one-attempt triggers; durable work remains in the database, so queue
   depth is supporting evidence rather than the source-of-truth backlog.

**Diagnostic steps:**

1. Query directly, per source (the alert's own query, without the threshold):

   ```promql
   label_replace(amcore_notification_delivery_due, "source", "notifications", "", "")
   or
   label_replace(amcore_ai_run_due, "source", "ai-runs", "", "")
   ```

2. Check `AMCoreMetricsCollectorErrors` for the relevant collector, per the
   likely-causes note above — a `0` reading during a collector outage is not
   evidence of health.
3. Open the **"Outbox due-now"** dashboard panel (Queues & outbox row) for the
   trend. Use the **"Queue jobs by state"** panel (Queues & outbox row) for
   `notifications` or `ai-runs` only as evidence about the wake path; unlike
   the durable due-now gauge, those
   one-attempt jobs do not represent the complete backlog.

**Mitigation:**

- If the dispatcher is falling behind: this is the same shape as
  [Backlog](#backlog) above — check worker throughput and scale or restart as
  needed.
- If the wake path is stalled: restore the worker/dispatcher and its recovery
  cron; it re-drains durable rows even when an individual wake job was lost.
- If the collector is stalled: restart the affected worker-role process(es)
  per [`metrics-collector-health.md`](metrics-collector-health.md#collector-errors).

**Escalation:** `Ticket` (more than 50 due for 30m) is worth investigating.
`Page` (more than 500 due for 15m) means the dispatcher is very likely not
keeping up, with real user-facing consequences (delayed notifications or AI run execution) —
escalate per your organization's on-call process.

## Dead-letter

**Symptom:** `AMCoreQueueDeadLetterTicket` (increase greater than 0 over 15 minutes) or
`AMCoreQueueDeadLetterBurstPage` (>10 signals in 5m) is firing for
`{{ $labels.queue }}`.

**Possible causes:**

1. A single email job exhausted its retries, a notification delivery became
   permanently failed, or a notification/AI-run wake job failed its one
   attempt (isolated, not systemic).
2. A systemic handler bug or downstream dependency outage caused a burst of
   the same queue-specific signal.

**Diagnostic steps:**

1. Use the query for the alert that fired. Both alerts have `for: 0m`.

   **Ticket** checks for an increase greater than 0 over 15 minutes:

   ```promql
   increase(amcore_queue_events_total{event="dead_letter"}[15m]) > 0
   ```

   **BurstPage** checks for an increase greater than 10 over 5 minutes:

   ```promql
   increase(amcore_queue_events_total{event="dead_letter"}[5m]) > 10
   ```

2. Branch on the `queue` label and structured event. For `email`, the view-only
   Bull Board may list the retained failed job (default retention:24 hours and
   1,000 jobs, trimmed when other jobs finish; individual settings can differ).
   This is not a strict24-hour window. It shows failure time and attempts; use
   worker logs for the cause. For `notifications`,
   distinguish `notification.delivery.dead_letter` (a durable DB delivery,
   not a BullMQ job) from `notification.dispatch_job_failed`. For `ai-runs`,
   inspect `ai.run.wake_job_failed`; the view-only Bull Board lists the queue
   (only the run id of a job) but the state of the run is in the database.
3. Open the **"Dead-letter rate"** dashboard panel (Queues & outbox row) to
   see whether this is an isolated job or a burst across many jobs in the
   same short window.

**Mitigation:**

- Identify the queue or durable work and inspect its safe failure reason,
  retained effect evidence and command receipt. A dead-letter signal does not
  prove that no external effect occurred or that a Bull Board record remains.
- Correct the cause before considering another attempt. For supported registered
  work, use [Background work controls](../../operations-console/background-work.md#controlled-actions)
  or their shared authenticated API with captured identity/revision, current
  personal reauthentication and a reason. Retry must pass that work's policy;
  unknown or accepted effects are not made retryable by a broker failure.
- Do not use raw BullMQ retry/remove or direct database edits to bypass policy,
  lifetime grants or strict audit. Read an uncertain command's existing receipt;
  do not create a replacement command. Database recovery polling does not grant
  unlimited business retries or erase provider uncertainty.

**Escalation:** `Ticket` (any single signal) — inspect the queue-specific
record while available, but not urgent otherwise. `Page` (>10 in 5m) means a
burst, very likely systemic — escalate per your organization's on-call
process.

## AI run recovery

**Symptom:** AI runs are slow to start or finish, a run is stuck `running`,
`amcore_ai_run_admission_total{outcome="lease_lost"}` is rising, or a run ended
`tool_effect_unknown` / `tool_state_inconsistent`.

**Recovery boundary:** a worker holds a run through a 10-minute lease. Guarded
writes from an expired or replaced lease are refused. A ready recovery worker
with database access examines expired leases in bounded batches and requeues or
ends runs according to their deadline, attempts and effect state.

Lease expiry alone does not update a row or prove that a provider call stopped.
A worker/database outage, contention or a recovery backlog can delay reclamation;
there is no unconditional 10-minute wall-clock completion guarantee. Check the
scheduled recovery result and database availability before assuming it ran.

**Diagnostic steps:**

1. `amcore_ai_run_due` and `amcore_ai_run_backlog{status}` show whether runs are
   waiting (see the due/backlog sections above). Each worker process executes at
   most two runs at a time; add worker replicas for more capacity.
2. A rising `lease_lost` rate means provider calls or tools outlast the lease
   (`AI_REQUEST_TIMEOUT_MS` is bounded below it) or workers are starved — check
   worker CPU/event-loop health and provider latency.
3. `failed` runs: `terminalReasonCode` names the cause (see the
   [terminal reasons](../../ai/runs.md#terminal-reasons)).
   `attempts_exhausted` with `errorCode=lease_expired` means the worker kept
   dying mid-run.
4. **`tool_effect_unknown`:** a side-effecting tool timed out, failed unclassified
   or was interrupted, so its effect may or may not have happened. AMCore stops the
   run and does **not** repeat the call or ask the model again. Reconcile in the
   downstream system using the action's idempotency key (`ai-tool:<invocation id>`,
   the `ai_tool_invocations` row with status `OUTCOME_UNKNOWN`); then, if the
   action should be repeated, have the user start a new run.
5. **`tool_state_inconsistent`:** durable tool state does not add up (a recorded
   result with no application step, or more than one unresolved tool action on the
   run). A tool may already have executed; recovery
   starts no additional call. Inspect the run's invocations, steps and downstream
   effects before any manual repair or new run.

The `ai-run-executions` registration reads database state; `ai-runs` carries
wake signals. An audited pause stops new claims, including recovery claims;
existing leases, deadline expiry and approval expiry continue. Resume through
the background-work command API after the incident. A running cancellation is
only a recorded request until the worker settles it. Operator retry creates
one linked text-only child after proved transient exhaustion without tools or
output. Artifact input and uncertain effects refuse retry. Cleanup archives
only never-started cancelled or expired runs after 30 days and preserves their
identity.

The optional Operations Console shows this state on the `ai-run-executions`
card in [Background work](../../operations-console/background-work.md).
It exposes the same audited commands when the frontend is enabled.

**Do not** reset a run's status or counters directly in SQL: the retry budget, the
attempt history and the tool records are one state machine, and a hand edit can
re-run a side effect. Use the cancel endpoint to stop a run; start a new run to
repeat work.

**Escalation:** `Ticket` for isolated unknown outcomes; `Page` when
`lease_lost` stays elevated together with a growing `ai_run_due`.
