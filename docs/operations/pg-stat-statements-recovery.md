# Recover From Password Exposure in `pg_stat_statements`

Use this procedure if utility tracking may have recorded a password in
`CREATE ROLE`, `ALTER ROLE`, `CREATE USER` or `ALTER USER`, or a password
verifier sent by psql's `\password`. See [security settings](pg-stat-statements-security.md#disable-utility-statement-tracking).

## 1. Stop new exposure

Set `pg_stat_statements.track_utility=off` and verify it before continuing;
follow [Bootstrap](pg-stat-statements-setup.md#step-1-load-and-harden-the-module).
This stops tracking new utility statements. Existing entries remain.

## 2. Establish the affected credentials

Use deployment/change records and the inventory of scripts executed during the
exposure window to determine every **target role** whose password was created
or changed. Do not inspect shell or psql history for this purpose: it can contain
the same cleartext secret. Do not derive the target from
`pg_stat_statements.userid`: that identifies the administrator that executed
the SQL, not the role named inside it.

If an older inline-password version of AMCore's `setup-roles.sql` was executed
during the window, rotate every AMCore role it provisioned. If the scope cannot
be established confidently, rotate every plausibly affected credential. Do not
display the `query` column merely to reduce the rotation set; doing so prints
the leaked secrets into terminal scrollback and session logs.

## 3. Rotate before clearing

For each target role identified in Step 2, generate a new strong, unique,
random value in a password manager and enter it directly at psql's prompt:

```text
\password <affected-role>
```

Never place the value in a SQL literal, shell argument, or temporary file.
Update each affected consumer and verify a new connection with its replacement
credential. Follow [database credential rotation](secret-rotation.md#database-credentials-amcore_migrator--amcore_runtime).
A password change leaves existing authenticated connections open. If compromise
requires closing them, use the approved incident procedure. Rotate before
clearing statistics.

## 4. Locate cache entries without returning their text

Run this as a superuser or provider-authorized equivalent. The filter matches
common password-bearing role statements. PostgreSQL filters them on the
server. The result contains only cache identifiers. `executed_by` is
diagnostic context and is **not** the target role rotated in Step 3.

```sql
SELECT userid::regrole AS executed_by, userid, dbid, queryid
FROM pg_stat_statements
WHERE query ~* '\m(CREATE|ALTER)[[:space:]]+(ROLE|USER)\M'
  AND query ~* '\mPASSWORD\M';
```

## 5. Clear exact entries

If the list from Step 4 is incomplete, stop before running any reset.

For each row from Step 4, pass its exact identity. Never substitute `0` for any of
`userid`, `dbid` or `queryid` in a targeted reset. Zero matches all values for
that argument. If any identifier is missing or zero, stop the targeted reset.

```sql
SELECT pg_stat_statements_reset(<userid>, <dbid>, <queryid>);
```

A full reset discards the entire server-wide statement history. Run the
following command only after obtaining separate approval for that loss.

```sql
SELECT pg_stat_statements_reset();
```

Use a privileged incident-response connection. Keep reset authority separate
from normal observation. The reset function has an optional fourth argument in
[PostgreSQL 17](https://www.postgresql.org/docs/17/pgstatstatements.html#PGSTATSTATEMENTS-FUNCTIONS) and
[PostgreSQL 18](https://www.postgresql.org/docs/18/pgstatstatements.html#PGSTATSTATEMENTS-FUNCTIONS).
The targeted call above leaves that argument at its default and clears matching
entries. A reset of only minimum and maximum times leaves the entries in place.

Repeat the identifier-only query from step 4. An empty result only confirms
that no remaining entries match its filter. If coverage is uncertain, follow
the incident procedure and obtain a separate decision before discarding the
full history. Follow the incident procedure for other copies of exposed material.

## See also

- [Bootstrap](pg-stat-statements-setup.md)
- [Security settings](pg-stat-statements-security.md)
- [The `amcore_observer` role](pg-stat-statements-observer-role.md)
- [Secret rotation](secret-rotation.md)
