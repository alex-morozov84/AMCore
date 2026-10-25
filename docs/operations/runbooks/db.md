# Database runbooks

Start here when an API database check fails. The later sections cover
`docs/operations/prometheus/amcore-alerts.yml`'s `amcore-db` alerts.

## Database check failed

A failed database check does not identify its cause. The API tests a small query
and the number of requests waiting for a connection. Either can fail the check.
A separate resource measurement can describe a different moment; it does not
explain why the earlier check failed.

1. Record when the check ran. Ask the deployment operator to identify the answering
   API server from diagnostic records. If it cannot be identified, keep that unknown;
   do not substitute a successful query from another server. Operators without
   approved deployment/database access should pass this information to that person.
2. From that API environment, check whether its configured database can be reached
   and a read-only query can complete. Use the existing approved database access.
   Do not print connection strings, passwords or credentials. A successful query
   from another computer does not establish access from the affected API.
3. If a query cannot complete, check database availability, the network path and the
   API's connection settings. Do not change the connection pool size as a general
   response to a failed database check.
4. If queries complete and independent evidence confirms requests waiting for pool
   connections, follow [Pool waiting](#pool-waiting). Keep the observation times
   separate. A later pool measurement does not establish the earlier failure's cause.
5. If the cause remains unclear, keep it unknown and inspect the server's diagnostic
   records around the check time. After remediation, request a new API readiness check. In an operations screen,
   use its Refresh control to read the next result.

```text
Database check failed -> check from the affected API environment
                         |-> query cannot complete -> connection/database diagnosis
                         |-> query completes + waiting confirmed -> Pool waiting
                         |-> no cause confirmed -> investigate; keep cause unknown
```

## Pool waiting

**Symptom:** `AMCoreDbPoolWaitingElevated` is firing (more than
`DATABASE_POOL_WAITING_THRESHOLD`, default 5, connections waiting on the pool
for 5m).

**Likely causes, ranked:**

1. The pool is genuinely undersized for current concurrent load.
2. Slow queries are holding connections open longer than they should, starving
   the pool for everyone else (check [Slow queries](#slow-queries) alongside
   this).
3. A connection leak — code acquiring a client and never releasing it back to
   the pool.

**Diagnostic steps:**

1. Open the **"Pool connections"** dashboard panel (Database row) to see the
   `total`/`idle`/`waiting` split over time — `waiting` climbing while `idle`
   stays near zero and `total` is already at its configured max confirms
   genuine saturation rather than a transient blip.
2. Check the **"Slow query rate"** panel (Database row) for the same window — a correlated
   rise suggests slow queries may contribute. Confirm the query or lock evidence
   before changing pool size.
3. Query the metric in Prometheus to see whether `waiting` recovers or keeps
   climbing:

   ```promql
   amcore_db_pool_connections{state="waiting"}
   ```

**Mitigation:**

- If slow queries are the root cause: fix or add an index for the offending
  query (see [Slow queries](#slow-queries) below) rather than only raising
  pool size, which would mask the underlying query cost.
- If genuinely undersized for legitimate load: raise the pool size
  configuration and redeploy.
- If a connection leak is suspected: this is a code-level fix (an
  acquire without a matching release) — a restart provides temporary relief
  but does not resolve it.

**Escalation:** this is `severity: ticket`. A Kubernetes readiness probe can
remove an unready replica from service, while the shipped Compose healthcheck
only marks it unhealthy; neither action inherently restarts this process.
File a ticket and investigate before pool exhaustion needs manual remediation.

## Slow queries

**Symptom:** `AMCoreDbSlowQueriesRising` is firing (queries slower than
`SLOW_QUERY_THRESHOLD_MS` recorded over the last 15m).

**Likely causes, ranked:**

1. A missing or ineffective index for a query whose data volume has grown.
2. A query plan regression after a schema or data-distribution change.
3. Lock contention from a concurrent long-running transaction elsewhere in
   the database, not the query itself being inherently slow.

**Diagnostic steps:**

1. Open the **"Slow query rate"** dashboard panel (Database row) to confirm
   the trend and its magnitude.
2. This alert's own count says _that_ slow queries are occurring, not _which_
   query. If `pg_stat_statements` isn't enabled yet, follow
   [Bootstrap](../pg-stat-statements-setup.md) (a one-time privileged step,
   not a migration), review the [security
   settings](../pg-stat-statements-security.md), and provision [the `amcore_observer`
   role](../pg-stat-statements-observer-role.md) first; then use [Slow query
   investigation](../slow-query-investigation.md)'s triage queries to
   identify the offending query directly.
3. Cross-check the **"5xx error ratio"** and **"p99 latency by route"** panels
   (HTTP row, see [`http.md`](http.md)) for the same window — never treat a
   slow-query alert alone as proof of user-facing impact; correlate first.

**Mitigation:**

- Add or fix an index once `pg_stat_statements` identifies the specific
  query.
- If caused by a concurrent long-running transaction (lock contention): find
  and terminate or fix that transaction rather than the queries it's blocking.

**Escalation:** this is `severity: ticket` by design — never page on slow
queries alone, since it is a cause signal, not a symptom of user-facing
impact. Correlate with the HTTP alerts in [`http.md`](http.md) before treating
it as urgent.
