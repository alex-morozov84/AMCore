# Slow Query Investigation (`pg_stat_statements`)

`amcore_db_slow_queries_total` (see [Observability](observability.md) and the
[DB runbook](runbooks/db.md#slow-queries)) tells you _that_ queries slower
than `SLOW_QUERY_THRESHOLD_MS` are occurring — it carries no query text or
model names, by design (label-cardinality rules in `observability.md`). It
cannot tell you _which_ query. Postgres's own `pg_stat_statements` extension
answers that question.

**Not enabled yet?** See [Bootstrap](pg-stat-statements-setup.md) (enabling
the extension), [security settings](pg-stat-statements-security.md), and [the `amcore_observer`
role](pg-stat-statements-observer-role.md) (the read-only role this guide's
queries run as) first — this file assumes both are already done. See
[Recovery](pg-stat-statements-recovery.md) if a password may have leaked
through it before you locked it down.

## Triage queries

Connected as `amcore_observer`. **Every query below filters `dbid` to the
current database** — required, not optional: `pg_stat_statements` is
cluster-wide, not per-database (see the sensitivity note in [the
`amcore_observer` role](pg-stat-statements-observer-role.md#cluster-wide-sensitivity)) —
omitting it silently mixes in any other database's queries on a shared
Postgres server:

```sql
-- Worst offenders by total time contributed (calls × mean_exec_time),
-- the number that actually matters for "what is costing the most."
SELECT query, calls, mean_exec_time, calls * mean_exec_time AS total_time_ms
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_time_ms DESC
LIMIT 20;

-- Cache-miss-heavy queries: a high shared_blks_read relative to
-- shared_blks_hit points at a missing index or a query reading far more
-- of the table than it needs, not at Postgres's I/O layer itself.
SELECT query, calls, shared_blks_hit, shared_blks_read
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY shared_blks_read DESC
LIMIT 20;
```

`dealloc` — how many statement entries have been evicted because
`pg_stat_statements.max` (default `5000`) was exceeded — is **not** a column
on `pg_stat_statements` itself; it lives on the separate
`pg_stat_statements_info` view (cluster-wide, one row, no `dbid` to filter):

```sql
SELECT dealloc, stats_reset FROM pg_stat_statements_info;
```

A non-zero, climbing `dealloc` means the tracked-statement cache is
genuinely full and evicting entries — **not LRU** (least-recently-used):
PostgreSQL's own docs state plainly that "information about the
least-executed statements is discarded," a frequency-based eviction, not a
recency-based one. A ticket-level check worth a quick look after enabling
this, not a shipped AMCore alert (no Prometheus metric wraps this view;
it is queried directly, by design — see [Observability](observability.md)).

## What this cannot tell you

**`pg_stat_statements` aggregates by `(userid, dbid, queryid, toplevel)` —
never by `application_name`.** (`toplevel` distinguishes a statement run
directly from one nested inside a function/procedure; verified against the
view's real column list on Postgres 16 — not four independent dimensions to
reason about, just the actual composite key PostgreSQL uses.)

Since every AMCore process (`web` **and** `worker`) connects as the same
`amcore_runtime` role, `pg_stat_statements` cannot attribute a slow query to
one process role over the other; every row you see is a mix of both. If you
need that distinction, `pg_stat_activity` (ADR-029/ADR-041's
`application_name` tagging —
[Observability](observability.md#operator-interpretation)) is the tool for
"which process is running this right now," not `pg_stat_statements`. The two
answer different questions: `pg_stat_statements` answers "which query, in
aggregate," `pg_stat_activity` answers "which role, right now."

## See also

- [Bootstrap](pg-stat-statements-setup.md) — enabling the extension.
- [Security settings](pg-stat-statements-security.md) — password-safe tracking.
- [The `amcore_observer` role](pg-stat-statements-observer-role.md) —
  provisioning the role this guide's queries run as.
- [Recovery](pg-stat-statements-recovery.md) — recovering from an exposed
  password.
- [DB runbook](runbooks/db.md#slow-queries) — the alert this guide is the
  investigation tool for.
- [Role separation](database-role-separation.md) — `amcore_migrator`/
  `amcore_runtime`, the two roles `amcore_observer` sits alongside.
- [Observability](observability.md) — `amcore_db_slow_queries_total` and
  `SLOW_QUERY_THRESHOLD_MS`.
