# Production Database Role Separation

A single Postgres role that can both run migrations and serve app traffic
means a bug or compromise in the running `api`/`worker` process has DDL
rights over your entire schema — it can `DROP TABLE`, `ALTER TABLE`, or grant
itself more access, not just read/write rows. This guide sets up two roles
instead: a **migrator/owner** role used only by `prisma migrate deploy`, and
a **runtime** role the app actually connects as, which can do DML and
nothing else.

**This is AMCore's own prescription of standard Postgres least-privilege
practice, not a Prisma-endorsed pattern.** Prisma's own `migrate deploy`
documentation covers only storing `DATABASE_URL` as a CI secret; a Prisma
maintainer's own community-discussion answer on this exact question is
"grant all privileges on the database." The mechanics below come from
Postgres's own privilege model — [`GRANT`](https://www.postgresql.org/docs/16/sql-grant.html)
and [`CREATE ROLE`](https://www.postgresql.org/docs/16/sql-createrole.html) —
not from anything Prisma publishes.

## The two roles

| Role              | Used by                              | Wired via                | Can                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amcore_migrator` | `prisma migrate deploy` only         | `MIGRATION_DATABASE_URL` | Everything needed to create/alter/drop schema objects — it **owns** every table/sequence it creates. Postgres ties `ALTER`/`DROP` rights to object ownership, not to a separately grantable privilege, so there is no narrower DDL grant to hand out here. |
| `amcore_runtime`  | the running `api`/`worker` processes | `DATABASE_URL`           | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on tables, `USAGE`/`SELECT` on sequences (for `serial`/identity columns). No `CREATE`, no ownership, no DDL of any kind.                                                                                               |

**`TRUNCATE` is deliberately not part of that DML grant.** It's a separate
privilege from `DELETE` in Postgres, and this setup never grants it to
`amcore_runtime` — verified `has_table_privilege` shows `INSERT`/`UPDATE`/
`DELETE` all `true` but `TRUNCATE` `false` after step 3, and a `TRUNCATE`
attempt fails with `permission denied for table`. A compromised or buggy
runtime connection can delete rows, including all of them with a `DELETE`
statement, but cannot instantly empty a table via `TRUNCATE` (which also
skips per-row triggers — including ADR-045's `audit_log` append-only
trigger — where `DELETE` does not).

This maps directly onto env vars this repo already has —
[`MIGRATION_DATABASE_URL`](deployment.md#migration-contract) was originally
documented purely as a pooler-bypass mechanism (a direct connection for the
one-shot migration step); in a role-separated production environment it
takes on a second job at the same time: carrying the migrator role's
credentials. If unset, the migration step falls back to `DATABASE_URL` — in
a role-separated setup that means it would try to migrate using the
_runtime_ role's credentials, which has no `CREATE`, so a misconfiguration
here fails loudly at migration time rather than silently under-provisioning
the runtime role.

**AMCore's Prisma schema uses `multiSchema`** (`apps/api/prisma/schema.prisma`
→ datasource `schemas = [...]`) — every model lives in `core`,
`notifications`, or `ai`, never in the default `public` schema. That
datasource array actually names six schemas (it also reserves `fitness`,
`finance`, and `subscriptions` for downstream use), but as shipped no model
uses `@@schema(...)` with any of those three, so the reference script
intentionally grants on only the populated three. Every statement below
that names a schema needs one line per schema your fork actually uses — if
you add the first model to one of the reserved three (or a new schema
name entirely), add a matching block before that migration reaches
production: a forgotten grant here doesn't fail at migration time, it fails
silently until the running app actually queries that schema.

## Setup

[`docker/postgres/setup-roles.sql`](../../docker/postgres/setup-roles.sql)
is the reference script — a template to review and run against whatever
Postgres you're actually using (which may not even be the compose stack's
bundled instance), not an automated compose service. Replace the password
placeholders with real, unique secrets before running it. It has three
steps, because AMCore's schemas don't exist until Prisma creates them:

1. **Before the first `prisma migrate deploy` ever runs against this
   database:** create both roles and grant `amcore_migrator`
   `CREATE`/`CONNECT` on the database, **plus** `CREATE` on the `public`
   schema specifically — even though no AMCore model lives there. Prisma's
   own bookkeeping table, `_prisma_migrations`, is created in whatever
   schema `MIGRATION_DATABASE_URL`'s connection defaults to, which is
   `public` per this repo's own `.env.example`. Verified against a real
   `prisma migrate deploy` run of every migration in this repo: without this
   grant, the very first migration fails immediately with `permission
denied for schema public`, before applying anything — Postgres 15+ no
   longer grants schema `CREATE` to `PUBLIC` by default, and this is a
   role-specific grant to `amcore_migrator`, not a schema this setup
   otherwise needs. It doesn't conflict with `public`'s `CREATE` being
   revoked from `PUBLIC` later in step 3 — that revokes the separate,
   pseudo-role ACL entry, verified not to affect this role-specific one.
   `core`/`notifications`/`ai` themselves don't exist yet on a brand-new
   database, so nothing else schema-specific belongs in this step.
2. **Run `prisma migrate deploy`**, with `MIGRATION_DATABASE_URL` wired to
   `amcore_migrator`'s credentials. This is what actually creates the three
   schemas and every table in them; `amcore_migrator` becomes their owner
   automatically, the same as table ownership above.
3. **Once the schemas exist** (either from step 2, or immediately if you're
   [adopting this on an existing database](#adopting-this-on-an-existing-database)):
   for each schema, grant `amcore_runtime` `USAGE` on the schema, DML on all
   its tables, `USAGE`/`SELECT` on all its sequences, and set
   `ALTER DEFAULT PRIVILEGES` so **future** tables/sequences in that schema
   auto-grant too, with no manual `GRANT` needed per migration.

Step 3's statements act on objects `amcore_migrator` owns — issuing a
`GRANT` on someone else's object requires the session to actually hold that
role's privileges, whether by inheritance or by `SET ROLE`, not merely by
being a member of it in a non-inheriting way. A plain
`GRANT amcore_migrator TO CURRENT_USER` (no `WITH` clause) already defaults
to a membership that inherits amcore_migrator's privileges (verified: a bare
`GRANT` defaults to `INHERIT true, SET true`), which alone is already enough
for both the schema/table `GRANT`s and `ALTER DEFAULT PRIVILEGES` below. The
script uses `SET ROLE amcore_migrator` unconditionally anyway — not because
of some split in what each statement needs, but because it's the one form
that works correctly regardless of how a _specific_ admin connection's
membership happens to be configured (verified: a membership granted
elsewhere `WITH INHERIT false` makes **both** kinds of statement fail
without `SET ROLE`, not just one). `RESET ROLE` plus revoking the temporary
membership at the end leaves no standing grant behind — verified the grants
and `ALTER DEFAULT PRIVILEGES` rules set up in between persist.

Separately: omitting `FOR ROLE`/`SET ROLE` entirely and just running
`ALTER DEFAULT PRIVILEGES IN SCHEMA core ...` as the admin succeeds with
**no error** but silently sets the rule for the admin's own future objects,
not `amcore_migrator`'s — a silent no-op, not a loud failure, and the reason
this script never relies on "whichever role is currently connected"
implicitly.

This whole approach works whether your admin connection is a true Postgres
superuser or a managed provider's `CREATEROLE`-holding admin user (verified
against both). If your admin connection has `CREATEROLE` rather than true
superuser, Postgres 16 itself _separately_ leaves you with a permanent,
built-in admin-only membership over roles you create — verified this grants
no `SET ROLE`/data access on its own, only the ability to further manage the
role (e.g. change its password or drop it). This script neither adds to
nor removes that separate, Postgres-native grant; it's an unavoidable
property of `CREATEROLE`, not a gap here.

Wire the resulting connection strings:

```bash
MIGRATION_DATABASE_URL="postgresql://amcore_migrator:<migrator-password>@<host>:5432/amcore?sslmode=require"
DATABASE_URL="postgresql://amcore_runtime:<runtime-password>@<host>:5432/amcore?sslmode=require"
```

Per [Production deploy profile](production-deploy-profile.md)'s secrets
checklist, the migrator role's URL is a `production` GitHub Environment
secret only — never `staging`, never a repo secret.

## Adopting this on an existing database

If you're retrofitting role separation onto a database that already has
`core`/`notifications`/`ai` populated (owned by whatever single role you
used before this guide existed), step 2 above is irrelevant — the schemas
already exist. Instead, run `REASSIGN OWNED BY <existing_role> TO
amcore_migrator;` (as a superuser, or as the role that currently owns the
objects) **before** step 3 — verified this transfers ownership of every
existing object across every schema in one statement, letting
`amcore_migrator` `ALTER`/`DROP` a table it didn't originally create. Then
run step 3 as usual: `REASSIGN OWNED BY` only moves ownership of objects
that already exist, not the `ALTER DEFAULT PRIVILEGES` rule for ones that
don't yet.

## What this doesn't need

- **The Prisma shadow database.** It's used only by `prisma migrate dev` for
  drift detection during local development; `migrate deploy` and `migrate
resolve` never touch it. The production migrator role needs no shadow-DB
  create/drop rights at all.
- **A runtime-role grant for `_prisma_migrations`.** Prisma creates and owns
  this bookkeeping table itself, under `amcore_migrator` — the running app
  never queries it, so `amcore_runtime` needs no access to it. (The migrator
  role itself does need `CREATE` on the `public` schema this table lands
  in — see step 1 above; this bullet is about the runtime role only.)

## Interaction with other parts of this repo

- **The `restore-drill` profile does not verify this.** It restores into a
  fresh scratch cluster with none of your roles, so it runs `pg_restore
--no-owner --no-privileges` — deliberately skipping ownership/ACL restore
  entirely (see [Backup & restore](backup-restore.md#restore-drill-rehearsing-a-restore-not-just-taking-one)).
  It proves your data and schema restore cleanly; it does not prove that
  restoring into a role-separated target reproduces these grants. That's a
  separate thing to verify in its own right if you rely on both.
- **The audit log is already append-only without this.** ADR-045's
  `core.audit_log` table uses a `BEFORE UPDATE/DELETE/TRUNCATE` trigger that
  blocks mutation for every role, including the table owner — so role
  separation is not a prerequisite for that guarantee. Once you have
  `amcore_runtime` set up, you _may_ additionally
  `REVOKE UPDATE, DELETE ON core.audit_log FROM amcore_runtime;` as defense
  in depth (a second, independent layer alongside the trigger), but it is
  optional hardening, not something this guide requires.

## See also

- [Deployment & migrations](deployment.md#migration-contract) — the one-shot
  migration contract this role split plugs into.
- [Production deploy profile](production-deploy-profile.md) — the secrets
  checklist that places the migrator role's URL in the `production`
  environment only.
- [Backup & restore](backup-restore.md) — what the `restore-drill` profile
  does and does not verify about roles, per above.
