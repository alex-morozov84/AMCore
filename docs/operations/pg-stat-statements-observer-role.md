# The `amcore_observer` Role

Use a dedicated operator role for `pg_stat_statements`. Reusing
`amcore_runtime` exposes its application credential to humans; granting it
`pg_monitor` also widens the role used by every API and worker process.

Complete [bootstrap](pg-stat-statements-setup.md) first. This provisioning is a
manual, target-specific operation, like [database role
separation](database-role-separation.md).

## Provision fail-closed

[`setup-roles.sql`](../../docker/postgres/setup-roles.sql) creates
`amcore_observer` as `NOLOGIN` and grants only database connectivity:

```sql
CREATE ROLE amcore_observer WITH NOLOGIN;
GRANT CONNECT ON DATABASE amcore TO amcore_observer;
```

`NOLOGIN` is required. A `LOGIN` role without a password can still authenticate
through a matching non-password HBA method such as `trust`; `NOLOGIN` prevents
all session login regardless of HBA configuration.

Generate a strong, unique, random password in a password manager and enter it
directly at psql's interactive prompt while the role remains disabled:

```text
\password amcore_observer
```

Never put the password in `CREATE ROLE` or `ALTER ROLE` SQL. See [Security
settings](pg-stat-statements-security.md). Activate the role only after the
password is set:

```sql
ALTER ROLE amcore_observer LOGIN;
```

## Grant `pg_monitor`

Run this through a connection that already holds `ADMIN OPTION` on
`pg_monitor`: a superuser on self-hosted PostgreSQL, or a provider-authorized
admin mechanism that has this capability.

```sql
GRANT pg_monitor TO amcore_observer;
```

Plain `CREATEROLE` is insufficient. Do not solve that by permanently granting
the setup administrator `pg_monitor WITH ADMIN OPTION`; that would give the
administrator both monitoring access and indefinite delegation power merely to
perform this one grant.

If the provider does not allow this grant, use its supported query-insights
facility instead of widening `amcore_runtime`; see [bootstrap's capability
contract](pg-stat-statements-setup.md#required-capability).

## Privilege surface

`pg_monitor` includes:

- `pg_read_all_settings` — all server configuration settings;
- `pg_read_all_stats` — all statistics views, including every role's query
  text and `queryid`;
- `pg_stat_scan_tables` — monitoring functions that may hold `ACCESS SHARE`
  locks for a long time.

It does not grant `SELECT` on application tables. It also does not grant
`EXECUTE` on `pg_stat_statements_reset`; [Recovery](pg-stat-statements-recovery.md)
uses a privileged incident-response connection for resets by default.

Without `pg_monitor`, another role's `pg_stat_statements` row remains visible,
but its `queryid` is `NULL` and its text is `<insufficient privilege>`.

## Cluster-wide sensitivity

`pg_stat_statements` and `pg_monitor` operate across every database in the
PostgreSQL server. An observer connected to `amcore` can read query statistics
from another database on that server. Treat its credential as server-wide
monitoring access, not as access to one database.

[Slow-query triage](slow-query-investigation.md#triage-queries) filters by the
current database, but filtering does not narrow the role's underlying access.
Nothing in AMCore reads this credential: there is no `OBSERVER_DATABASE_URL`.
Store it for operator use and [rotate
it](secret-rotation.md#amcore_observer-pg_stat_statements-investigation-role)
accordingly.

## See also

- [Bootstrap](pg-stat-statements-setup.md)
- [Security settings](pg-stat-statements-security.md)
- [Recovery](pg-stat-statements-recovery.md)
- [Slow query investigation](slow-query-investigation.md)
