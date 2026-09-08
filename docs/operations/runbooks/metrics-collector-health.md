# Metrics collector health runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s
`amcore-metrics-collector-health` group. These alerts are about the metrics
pipeline itself, not application behavior. When
`AMCoreMetricsCollectorErrors` names a collector that resets a zero-label
gauge on failure, treat that gauge's `0` as **unknown**, not healthy.

## Absent queue metrics

**Symptom:** `AMCoreQueueMetricsAbsent` is firing (`amcore_queue_jobs` has
been absent for 15m).

**Likely causes, ranked:**

1. Every `worker`/`all`-role process is down (queue metrics are only exported
   by those roles — see `docs/operations/observability.md`'s Metric Families
   reference).
2. The BullMQ collector itself is stuck (e.g. blocked on a Redis call that
   never returns).
3. A scrape-path outage unrelated to queues specifically (check whether
   _other_ metrics from the same target are also missing — if so, this is a
   scrape/target problem, not a queue-collector problem).

**Diagnostic steps:**

1. Confirm this is genuinely "absent," not "zero jobs everywhere," by
   querying Prometheus directly:

   ```promql
   absent(amcore_queue_jobs)
   ```

2. Check the **"Queue jobs by state"** dashboard panel (Queues & outbox row)
   — a genuinely empty result set (no series at all) confirms absence; any
   series present, even all-zero, means the metric is not actually absent and
   this alert should not be the one firing.
3. Check whether `worker`/`all`-role processes are up at all (container/pod
   status) and, if they are, whether `AMCoreMetricsCollectorErrors` (see
   [Collector errors](#collector-errors) below) is also firing for the
   `queue_jobs` collector specifically.

**Mitigation:**

- If every worker-role process is down: restart per your deployment's normal
  process-recovery path; this is a process-availability incident, not a
  metrics-only issue.
- If processes are up but the collector is stuck: a rolling restart of the
  affected worker-role process(es) clears a stuck collector; if it recurs,
  treat as a bug in the collector's Redis interaction, not a one-off.

**Escalation:** this is `severity: page` — it means either every worker is
down or the BullMQ collector is stuck, both of which imply queue processing
itself may have stopped. Escalate per your organization's on-call process.

## Collector errors

**Symptom:** `AMCoreMetricsCollectorErrors` is firing (the named collector,
`{{ $labels.collector }}`, has been erroring for 10m).

**Likely causes, ranked:**

1. The collector's data source (Redis, the database pool, BullMQ) is itself
   degraded, and the collector is timing out trying to sample it.
2. A code-level bug in the specific collector named in the alert.

**Diagnostic steps:**

1. Read the `collector` label on the firing alert instance — this identifies
   exactly which collector is failing.
2. This is the _only_ signal for a stalled collector on
   `amcore_notification_delivery_due`, `amcore_ai_run_due`, and
   `amcore_redis_ping_seconds` specifically: these are zero-label gauges, and
   a timeout resets them to a visible `0`, not absence, so `absent()` can
   never catch a stalled collector for them. If this alert is firing for one
   of those three, treat its `0` reading as unknown, not "healthy and empty" —
   check [`queues.md`](queues.md#outbox-backlog) or
   [`redis.md`](redis.md#reconnecting) for the underlying dependency's own
   health rather than trusting the `0`.
3. Check the **"Collector error rate"** dashboard panel (Metrics collector
   health row) to see whether one collector or several are affected — several
   at once points at a shared dependency (Redis, DB pool) rather than a
   single collector bug.

**Mitigation:**

- If the underlying dependency (Redis, DB) is degraded: mitigate that
  dependency first via [`redis.md`](redis.md) or [`db.md`](db.md); the
  collector should recover once its data source does.
- If isolated to one collector with no dependency-level issue: treat as a
  collector-specific bug and investigate that collector's code path
  directly.

**Escalation:** this is `severity: page`. It is the direct failure signal for
the named collector. Labeled backlog series can disappear when empty or on
failure, and no separate absence alert covers them, so correlate their
absence with this collector error before calling it healthy. Escalate per
your organization's on-call process.
