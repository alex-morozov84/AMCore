# Queue runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-queues` group.
These alerts can be suppressed by the Redis inhibition rule in
`docker/monitoring/alertmanager/alertmanager.yml` — if `AMCoreRedisReconnectingPage`
(see [`redis.md`](redis.md#reconnecting)) is also firing, check that first;
these alerts being silent does not mean the backlog is fine.

<!-- AMCORE_CONSOLE_BACKGROUND_WORK_START -->

To see the current state of every queue (waiting, active, delayed, failed, paused,
and a sampled age of the oldest queued job) without a metrics query, open the Operations
Console's [Background work](../../operations-console/background-work.md) screen. It
is read-only and shows `notifications` and `ai-runs` as wake queues: their real
backlog is in the database, as described under [Outbox backlog](#outbox-backlog).

<!-- AMCORE_CONSOLE_BACKGROUND_WORK_END -->

## Backlog

**Symptom:** `AMCoreQueueBacklogTicket` (>100 waiting jobs in `email`/`default`
for 30m) or `AMCoreQueueBacklogPage` (>1000 for 15m) is firing. Both already
gate on the queue not being deliberately paused
(`amcore_queue_paused{queue=...} == 0`) — see [Paused](#paused) below.

**Likely causes, ranked:**

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
3. Check whether `worker`/`all`-role process replica count and health look
   normal (container/pod status) — a drop in worker count is the single most
   common cause.
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

**Likely causes, ranked:**

1. Someone paused the queue deliberately through the BullMQ API (the queue
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

2. Check your team's change log / deploy history for who or what paused the
   queue and why (the view-only queue board shows that a queue is paused, not
   who paused it).
3. Open the **"Queue paused"** dashboard panel (Queues & outbox row) to see
   the pause duration and whether other queues are affected too.

**Mitigation:**

- If deliberate and still needed: no action — this alert exists precisely so
  an intentional pause doesn't go unnoticed as "delivery silently stopped."
- If accidental or no longer needed: resume the queue with the BullMQ API
  through your controlled operational tooling. The queue board cannot resume
  a queue, and no setting makes it able to.

**Escalation:** this is `severity: page` specifically because a paused queue
is silent, user-facing delivery stop if it wasn't deliberate — treat every
occurrence as needing a human confirmation of intent, even if it turns out to
be a non-event.

## Outbox backlog

**Symptom:** `AMCoreOutboxBacklogTicket` (due-now gauge above 50 for 30m) or
`AMCoreOutboxBacklogPage` (above 500 for 15m) is firing, for either the
`notifications` or `ai-runs` source (`{{ $labels.source }}`).

**Likely causes, ranked:**

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

**Symptom:** `AMCoreQueueDeadLetterTicket` (any dead-letter signal) or
`AMCoreQueueDeadLetterBurstPage` (>10 signals in 5m) is firing for
`{{ $labels.queue }}`.

**Likely causes, ranked:**

1. A single email job exhausted its retries, a notification delivery became
   permanently failed, or a notification/AI-run wake job failed its one
   attempt (isolated, not systemic).
2. A systemic handler bug or downstream dependency outage caused a burst of
   the same queue-specific signal.

**Diagnostic steps:**

1. Query directly:

   ```promql
   increase(amcore_queue_events_total{event="dead_letter"}[5m])
   ```

2. Branch on the `queue` label and structured event. For `email`, the view-only
   Bull Board may list the retained failed job for 24h or 1000 jobs (it shows
   that it failed, when and after how many attempts, not why: use the worker
   logs for the cause). For `notifications`,
   distinguish `notification.delivery.dead_letter` (a durable DB delivery,
   not a BullMQ job) from `notification.dispatch_job_failed`. For `ai-runs`,
   inspect `ai.run.wake_job_failed`; the view-only Bull Board lists the queue
   (only the run id of a job) but the state of the run is in the database.
3. Open the **"Dead-letter rate"** dashboard panel (Queues & outbox row) to
   see whether this is an isolated job or a burst across many jobs in the
   same short window.

**Mitigation:**

- If isolated: fix or discard the durable row/job data according to the
  queue-specific event; do not assume every signal has a Bull Board record.
- If a burst: identify the shared cause (a handler bug, a downstream
  dependency outage during the burst window) and fix that. Manually retry a
  retained BullMQ job with the BullMQ API through your controlled operational
  tooling, only while the job remains valid (the Bull Board is view-only);
  durable notification/AI work is recovered by its dispatcher cron.

**Escalation:** `Ticket` (any single signal) — inspect the queue-specific
record while available, but not urgent otherwise. `Page` (>10 in 5m) means a
burst, very likely systemic — escalate per your organization's on-call
process.

## AI run recovery

**Symptom:** AI runs are slow to start or finish, a run is stuck `running`,
`amcore_ai_run_admission_total{outcome="lease_lost"}` is rising, or a run ended
`tool_effect_unknown` / `tool_state_inconsistent`.

**What the system guarantees:** a worker holds a run only through a lease. A
worker that stalls past it is replaced, and its late writes are refused (they show
as `lease_lost`); the reaper requeues or ends the run. A run is never left
`running` forever: a lost lease is reclaimed within the reaper interval plus the
lease length (10 minutes).

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
   result with no application step). A tool may already have executed; recovery
   starts no additional call. Inspect the run's invocations, steps and downstream
   effects before any manual repair or new run.

**Do not** reset a run's status or counters directly in SQL: the retry budget, the
attempt history and the tool records are one state machine, and a hand edit can
re-run a side effect. Use the cancel endpoint to stop a run; start a new run to
repeat work.

**Escalation:** `Ticket` for isolated unknown outcomes; `Page` when
`lease_lost` stays elevated together with a growing `ai_run_due`.
