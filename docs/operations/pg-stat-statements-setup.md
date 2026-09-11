# `pg_stat_statements` Bootstrap

This is the one-time procedure for enabling PostgreSQL's
`pg_stat_statements` extension. Read the [security settings](pg-stat-statements-security.md)
before starting, then provision [the `amcore_observer`
role](pg-stat-statements-observer-role.md). The extension is never installed by
a Prisma migration.

## Required capability

On self-hosted PostgreSQL, use a superuser. On a managed service, use the
provider-authorized mechanism that can both install `pg_stat_statements` and
grant `pg_monitor`; verify those capabilities in the provider's current docs.
A plain `CREATEROLE` connection, including the one used for
[`setup-roles.sql`](../../docker/postgres/setup-roles.sql), cannot do either.

If the provider permits neither operation, do not widen `amcore_runtime`.
Use its supported query tooling instead, such as [Amazon CloudWatch Database
Insights](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html)
or [Cloud SQL Query
Insights](https://cloud.google.com/sql/docs/postgres/using-query-insights).

## Step 1: load and harden the module

`pg_stat_statements` requires `shared_preload_libraries`, whose changes need a
server restart. Preserve every library already in that setting.

### Path A: server configuration access

Read the current `shared_preload_libraries` value, append
`pg_stat_statements`, and set all three values before one restart. For
`postgresql.conf`, where `pgaudit` is an existing library:

```ini
shared_preload_libraries = 'pgaudit,pg_stat_statements'
pg_stat_statements.track_utility = off
pg_stat_statements.track = top
```

For direct server flags:

```bash
postgres \
  -c shared_preload_libraries=pgaudit,pg_stat_statements \
  -c pg_stat_statements.track_utility=off \
  -c pg_stat_statements.track=top
```

Replace `pgaudit` with the complete existing list; if it is empty, use only
`pg_stat_statements`. Restart and verify:

```sql
SHOW shared_preload_libraries;
SHOW pg_stat_statements.track_utility; -- must be off
SHOW pg_stat_statements.track;         -- must be top
```

### Path B: live SQL only

PostgreSQL does not recognize the module's own settings before its first load,
so this path has a short exposure window and must run in this order:

1. Read the complete existing list:

   ```sql
   SHOW shared_preload_libraries;
   ```

2. Append the module without dropping existing entries:

   ```sql
   -- Example when SHOW returned pgaudit:
   ALTER SYSTEM SET shared_preload_libraries = 'pgaudit,pg_stat_statements';
   -- If SHOW returned an empty string, use 'pg_stat_statements' alone.
   ```

3. Restart the server. Collection begins now, before the extension exists.

4. Immediately persist the hardening settings. Do not create or rotate
   credentials after Step 3.

   ```sql
   ALTER SYSTEM SET pg_stat_statements.track_utility = off;
   ALTER SYSTEM SET pg_stat_statements.track = 'top';
   ```

5. Reload the configuration — a restart is not required here:

   ```sql
   SELECT pg_reload_conf();
   ```

   `pg_stat_statements.track_utility` and `.track` are `context=superuser`
   settings, unlike `shared_preload_libraries` in Step 3
   (`context=postmaster`, which genuinely needs a restart). A reload
   propagates a `context=superuser` change to every already-open backend
   immediately, not only to new connections — verified live against real
   PostgreSQL 16 and PostgreSQL 18 containers, holding one backend's session
   open across the reload and observing its own `SHOW` output flip without
   reconnecting.

6. Verify before performing any password-bearing operation (any already-open
   session, or a fresh connection, will now correctly report the hardened
   values):

   ```sql
   SHOW pg_stat_statements.track_utility; -- must be off
   SHOW pg_stat_statements.track;         -- must be top
   ```

See [Security settings](pg-stat-statements-security.md) for why inline password
SQL leaks cleartext and why even `\password` must wait until verification.

### Managed services

Managed services commonly expose preload settings through a parameter group or
instance flag rather than `ALTER SYSTEM`. Follow the provider's current
`pg_stat_statements` instructions, preserve its existing preload list, apply
`track_utility=off`, and perform any required restart. The capability contract
above still applies; provider implementations are not assumed interchangeable.

## Step 2: create the extension

After Step 1 is verified:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

This installs the views and reset function that expose the data already being
collected. Creating the extension before the preload restart may succeed, but
querying it then fails with `pg_stat_statements must be loaded via
shared_preload_libraries`.

The bundled development PostgreSQL already uses Path A through
`docker-compose.yml`, with `track_utility=off` and `track=top`. Its `amcore`
bootstrap user can run Step 2 directly.

## Next steps

- [Security settings](pg-stat-statements-security.md) — threat model and tuning.
- [The `amcore_observer` role](pg-stat-statements-observer-role.md) — safe query access.
- [Recovery](pg-stat-statements-recovery.md) — previously exposed passwords.
- [Slow query investigation](slow-query-investigation.md) — triage queries.
