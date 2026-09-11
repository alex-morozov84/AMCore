# `pg_stat_statements` Security Settings

Apply these settings as part of [bootstrap](pg-stat-statements-setup.md), before
creating or rotating database credentials.

## Disable utility-statement tracking

PostgreSQL defaults `pg_stat_statements.track_utility` to `on`. Utility
statements include `CREATE ROLE` and `ALTER ROLE`; when they contain an inline
`PASSWORD '...'`, the tracked query text contains that cleartext password.
Anyone with `pg_monitor` can then read it. Collection starts when the module is
preloaded, not when `CREATE EXTENSION` installs its SQL interface.

AMCore therefore requires:

```ini
pg_stat_statements.track_utility = off
```

Never put passwords in SQL literals. Use psql's interactive `\password`, which
hashes client-side and sends a SCRAM verifier instead of cleartext. With utility
tracking enabled, that verifier can still enter the statistics cache and become
material for offline password guessing. Keep `track_utility=off` as the primary
control and use strong, unique, randomly generated passwords as defense in
depth.

If the module must first load with PostgreSQL's default, perform no
password-bearing operation until the live-SQL path's `pg_reload_conf()` step
completes and a connection confirms `SHOW pg_stat_statements.track_utility`
returns `off`. `track_utility` is a `context=superuser` setting, so a
configuration reload propagates the change to every already-open backend
session, not only new ones — verified live against real PostgreSQL 16 and
PostgreSQL 18 containers (a backend's session held open across the reload
observed its own value flip without reconnecting). A reload is sufficient
here; no restart is required beyond the one already needed to load the
module itself. See bootstrap's [live-SQL
path](pg-stat-statements-setup.md#path-b-live-sql-only).

## Keep the remaining defaults

Keep `pg_stat_statements.track=top`, which counts top-level statements once.
Changing it to `all` also counts statements nested inside functions and changes
the meaning of the triage results.

Do not enable `pg_stat_statements.track_planning` by default; PostgreSQL warns
that planning statistics can add noticeable overhead under concurrent load.
`compute_query_id=auto` already allows the module to enable query identifiers.

## If tracking was unsafe

If utility tracking was enabled during any inline password operation, follow
[Recovery](pg-stat-statements-recovery.md). Disabling tracking prevents new
exposure but does not remove entries already collected.
