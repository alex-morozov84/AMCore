# Recover From Password Exposure in `pg_stat_statements`

Use this procedure if utility tracking was enabled when anyone ran literal
`CREATE ROLE`, `ALTER ROLE`, `CREATE USER`, or `ALTER USER` SQL containing a
password. The recorded query text can expose that password to every
`pg_monitor` member.

## 1. Stop new exposure

Set `pg_stat_statements.track_utility=off` and verify it before continuing;
follow [Bootstrap](pg-stat-statements-setup.md#step-1-load-and-harden-the-module).
This prevents new entries but does not remove existing ones.

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
Rotate before clearing statistics so the exposed credential becomes invalid as
soon as possible.

## 4. Locate cache entries without returning their text

Run this as a superuser or provider-authorized equivalent. Filtering happens
server-side; the result contains only cache identifiers. `executed_by` is
diagnostic context and is **not** the target role rotated in Step 3.

```sql
SELECT userid::regrole AS executed_by, userid, dbid, queryid
FROM pg_stat_statements
WHERE query ~* '\m(CREATE|ALTER)[[:space:]]+(ROLE|USER)\M'
  AND query ~* '\mPASSWORD\M';
```

## 5. Clear exact entries

For each row from Step 4, pass its exact identity. Never substitute `0` for
`userid` or `dbid`; zero is a wildcard and can remove other users' or databases'
entries sharing the same `queryid`.

```sql
SELECT pg_stat_statements_reset(<userid>, <dbid>, <queryid>);
```

If enumeration is uncertain, use the blunt fallback. It discards the entire
server-wide statement history:

```sql
SELECT pg_stat_statements_reset();
```

Prefer executing resets through the privileged incident-response connection.
If policy instead requires `amcore_observer` to perform them, keep the widened
privilege temporary:

```sql
GRANT EXECUTE ON FUNCTION pg_stat_statements_reset(oid,oid,bigint)
  TO amcore_observer;
-- Perform the reset calls.
REVOKE EXECUTE ON FUNCTION pg_stat_statements_reset(oid,oid,bigint)
  FROM amcore_observer;
```

## See also

- [Bootstrap](pg-stat-statements-setup.md)
- [Security settings](pg-stat-statements-security.md)
- [The `amcore_observer` role](pg-stat-statements-observer-role.md)
- [Secret rotation](secret-rotation.md)
