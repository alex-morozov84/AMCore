# Redis runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-redis` group.
Note the inhibition rule in `docker/monitoring/alertmanager/alertmanager.yml`:
`AMCoreRedisReconnectingPage` suppresses the queue/outbox backlog alerts in
[`queues.md`](queues.md) — if you see this alert, expect the backlog alerts to
be suppressed even though the underlying backlog is very likely building.

## Reconnecting

**Symptom:** `AMCoreRedisReconnectingTicket` (any reconnect in 5m) or
`AMCoreRedisReconnectingPage` (reconnecting for 5m straight) is firing for a
queue-critical client (`{{ $labels.client }}` — `queue_producer` or
`queue_worker`).

**Likely causes, ranked:**

1. The Redis instance itself is unreachable or restarting (network partition,
   Redis process crash/restart, managed-Redis failover).
2. Redis is reachable but overloaded (memory pressure, blocked by a long-
   running command) and dropping/refusing connections intermittently.
3. A client-side network configuration issue (e.g. `REDIS_URL` pointing at a
   stale endpoint after an infrastructure change).

**Diagnostic steps:**

1. Query directly to see which client(s) are affected and for how long:

   ```promql
   rate(amcore_redis_client_events_total{client=~"queue_.*",event="reconnecting"}[5m])
   ```

2. Open the **"Client event rate"** dashboard panel (Redis row) and filter for
   `client=~"queue_.*"` to confirm the trend, and the **"Ping latency"** panel
   for the same window — rising ping latency alongside reconnects points at
   an overloaded-but-reachable Redis rather than a hard outage.
3. Check Redis's own health directly (`redis-cli PING`, or your managed
   provider's status/metrics) — this alert only observes the effect from the
   application side, not Redis's own state.
4. Check the **"Queue jobs by state"** and **"Outbox due-now"** dashboard
   panels (Queues & outbox row) — a sustained reconnect almost always means
   jobs stop flowing, visible there as `waiting`/due-now counts climbing.

**Mitigation:**

- If Redis itself is down: restore Redis availability first (restart the
  process, fail over to a replica, or wait out a managed-provider incident);
  there is no in-memory fallback for queues, so jobs simply stop flowing
  until Redis recovers.
- If Redis is up but overloaded: address the overload (check for a blocking
  command, memory pressure) rather than restarting the application, which
  will just reconnect and hit the same overloaded instance.
- If a configuration issue: fix `REDIS_URL` and redeploy.

**Escalation:** `Ticket` is any single reconnect in 5m — worth a look, not
urgent. `Page` means 5m of sustained reconnecting with jobs not flowing —
escalate per your organization's on-call process. Expect the queue/outbox
backlog alerts to be inhibited while this fires (see the note at the top of
this file) — do not treat their silence as "queues are fine."

## Throttler degraded

**Symptom:** `AMCoreRedisThrottlerDegradedTicket` (any degrade in 5m) or
`AMCoreRedisThrottlerDegradedPage` (degraded for 15m straight) is firing.

**Likely causes, ranked:**

1. The `throttler` Redis client (a separate client role from the
   queue-critical ones above — see `docs/operations/observability.md`'s
   Metric Families reference) lost its Redis connection, and the rate limiter
   fell back to per-process in-memory state.
2. Same root causes as [Reconnecting](#reconnecting) above, but affecting the
   `throttler` client specifically rather than the queue clients.

**Diagnostic steps:**

1. Query directly:

   ```promql
   rate(amcore_redis_client_events_total{client="throttler",event="degraded"}[5m])
   ```

2. Open the **"Client event rate"** dashboard panel (Redis row) and filter for
   `client=throttler` to confirm the trend.
3. Check Redis's own health the same way as [Reconnecting](#reconnecting)
   above — this is very likely the same underlying Redis issue observed
   through a different client.
4. If running more than one replica, be aware the effective global rate limit
   silently becomes N times the configured value while degraded — check
   `rate_limit_decisions_total` (`amcore_rate_limit_decisions_total`) and the
   **"Decisions by policy/outcome"** dashboard panel (Rate limiting row) for
   an unexpected rise in `allowed` outcomes during the same window as evidence
   this is actually happening, not just theoretically possible.

**Mitigation:**

- Restore Redis availability for the `throttler` client the same way as
  [Reconnecting](#reconnecting) above.
- If abuse is a concern while degraded (since the effective limit is now N×
  across N replicas), reduce abusive traffic externally or temporarily scale
  to one API replica only if availability and capacity permit. Changing
  `RATE_LIMIT_POLICIES` requires a code change and redeploy; both sustained
  `rate` and `burst` must account for replica count, not only `burst`.

**Escalation:** `Ticket` is a single degrade — not urgent, but a real gap in
abuse control while it lasts. `Page` means 15m of sustained in-memory
fallback — an ongoing abuse-control regression, not graceful degradation;
escalate per your organization's on-call process.
