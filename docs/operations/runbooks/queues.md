# Queue runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-queues` group.
These alerts can be suppressed by the Redis inhibition rule in
`docker/monitoring/alertmanager/alertmanager.yml` — if `AMCoreRedisReconnectingPage`
(see [`redis.md`](redis.md#reconnecting)) is also firing, check that first;
these alerts being silent does not mean the backlog is fine.

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

1. Someone paused the queue deliberately via Bull Board (or the BullMQ API
   directly) and this alert is a confirmation, not a surprise.
2. The pause was accidental (a script or manual action targeting the wrong
   queue).
3. An automated process paused it as a safety measure and the underlying
   condition that triggered the pause hasn't been addressed yet.

**Diagnostic steps:**

1. Query directly to confirm which queue and since when:

   ```promql
   amcore_queue_paused == 1
   ```

2. Check Bull Board (or your team's change log / deploy history) for who or
   what paused the queue and why.
3. Open the **"Queue paused"** dashboard panel (Queues & outbox row) to see
   the pause duration and whether other queues are affected too.

**Mitigation:**

- If deliberate and still needed: no action — this alert exists precisely so
  an intentional pause doesn't go unnoticed as "delivery silently stopped."
- If accidental or no longer needed: resume the queue via Bull Board only
  when it is explicitly enabled and writable, or use the BullMQ API through
  your controlled operational tooling.

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
   trend. Use **"Queue jobs by state"** for `notifications` or `ai-runs` only
   as evidence about the wake path; unlike the durable due-now gauge, those
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

2. Branch on the `queue` label and structured event. For `email`, Bull Board
   may retain the failed job for 24h or 1000 jobs. For `notifications`,
   distinguish `notification.delivery.dead_letter` (a durable DB delivery,
   not a BullMQ job) from `notification.dispatch_job_failed`. For `ai-runs`,
   inspect `ai.run.wake_job_failed`; the shipped Bull Board does not register
   the `ai-runs` queue.
3. Open the **"Dead-letter rate"** dashboard panel (Queues & outbox row) to
   see whether this is an isolated job or a burst across many jobs in the
   same short window.

**Mitigation:**

- If isolated: fix or discard the durable row/job data according to the
  queue-specific event; do not assume every signal has a Bull Board record.
- If a burst: identify the shared cause (a handler bug, a downstream
  dependency outage during the burst window) and fix that. Manually retry a
  retained BullMQ job only when Bull Board is explicitly enabled and writable
  (`ENABLE_BULL_BOARD=true`, `BULL_BOARD_READ_ONLY=false`) and the job remains
  valid; durable notification/AI work is recovered by its dispatcher cron.

**Escalation:** `Ticket` (any single signal) — inspect the queue-specific
record while available, but not urgent otherwise. `Page` (>10 in 5m) means a
burst, very likely systemic — escalate per your organization's on-call
process.
