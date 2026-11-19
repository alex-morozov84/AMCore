# Production Database Role Separation

Use separate PostgreSQL credentials for schema ownership and normal API/worker
traffic. The runtime role can modify permitted application rows without owning
the application schema. Keep owner credentials out of long-running services.

## The two roles

| Role              | Use                                                                                              | Connection configuration                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `amcore_migrator` | One-shot migrations and explicitly authorized owner operations, such as guarded seed and restore | `MIGRATION_DATABASE_URL` in the reference Compose setup                                      |
| `amcore_runtime`  | Normal API/worker data access                                                                    | Native `DATABASE_URL`; Compose `COMPOSE_DATABASE_URL` becomes the container's `DATABASE_URL` |

The template grants runtime `SELECT`, `INSERT`, `UPDATE` and `DELETE` on application
tables, plus schema `USAGE` and sequence `USAGE`/`SELECT`. It does not grant runtime
ownership, schema `CREATE`, table `TRUNCATE` or membership in the owner role.
Existing table guards can reject operations despite those grants.

These are permissions on the managed application schemas, not a complete database
sandbox. Review existing memberships, direct grants and `PUBLIC` privileges when
adopting the template. PostgreSQL grants database `TEMPORARY` and function `EXECUTE`
to `PUBLIC` by default; this template does not revoke every such privilege.
Do not describe it as prohibiting all DDL or every possible operation elsewhere.
See [PostgreSQL privileges](https://www.postgresql.org/docs/18/ddl-priv.html).

The shipped Prisma models use `core`, `notifications` and `ai`.
`apps/api/prisma/schema.prisma` also lists reserved schemas with no shipped models.
When a fork starts using another schema, extend its reviewed grants/default privileges
before admitting application traffic. A successful migration does not prove runtime access.

## Migration connection lifecycle

The [migration image](migrator-image.md#process-and-database-lifecycle) adds
`client_connection_check_interval=50ms` to its selected datasource URL. The role
template does not set this role default. Do not add `ALTER ROLE` as a substitute:
that can affect unrelated consumers, including shared-role installations.

Use a direct endpoint and run the image's [exact-endpoint preflight](migrator-image.md#endpoint-preflight)
with the selected owner credential, image, network and TLS configuration.
Role provisioning and an ordinary successful connection do not establish endpoint
capability. Unknown or failed preflight blocks rollout.

## Setup

Before running the [reference SQL template](../../docker/postgres/setup-roles.sql):

- Obtain authority for the selected database and confirm its identity and backup/recovery plan.
- Use an administrator able to create/manage the roles and grant the database/schema
  rights below. `CREATEROLE` alone does not grant ownership of the selected database,
  arbitrary objects or predefined monitoring roles. Check provider-specific capabilities.
- Review the database name, schemas and existing roles. The template is not an
  idempotent installer. Run only the applicable stages, not the whole file blindly.
- For the bundled production stack, follow [single-host role setup](single-host-compose.md#5-start-infrastructure-and-create-the-roles)
  and its complete saved overlays. The template does not configure network authentication or TLS.

1. **Create both roles before the first migration.** Run template Step1 while the
   roles remain `NOLOGIN`. Grant the owner `CONNECT`/`CREATE` on the selected database
   and `CREATE` on `public`, where the reference connection keeps Prisma's ledger.
   New application schemas do not exist yet. Keep runtime without schema ownership.

   Assign separate generated passwords through interactive `psql` while `NOLOGIN`:

   ```text
   \password amcore_migrator
   \password amcore_runtime
   ```

   A passwordless `LOGIN` role can still connect through non-password authentication;
   it is not equivalent to `NOLOGIN`. Setting a password does not enable login.
   `\password` avoids sending a cleartext password in SQL. Do not put passwords
   in literal SQL, command arguments, logs or reports; see
   [query-statistics security](pg-stat-statements-security.md).

   Only after both passwords are set:

   ```sql
   ALTER ROLE amcore_migrator LOGIN;
   ALTER ROLE amcore_runtime LOGIN;
   ```

2. **Apply migrations as the owner.** Configure its direct connection, complete the
   endpoint preflight, then run the one-shot migrator before API/worker startup.
   Preserve the image's Tini entrypoint and strict native-CLI TLS settings.
   If migration fails or its result is unknown, stop rollout and follow
   [migration recovery](deployment.md#rollback). Do not substitute runtime credentials.
   Guarded seed is a separate owner operation, not an implicit migration side effect;
   follow [seeding](deployment.md#seeding) before initial organization setup.
3. **Grant runtime access after schemas exist.** Apply template Step3 to every used
   schema: schema `USAGE`, current table/sequence grants and default privileges for
   future objects created by `amcore_migrator`. Keep the temporary membership,
   `SET ROLE amcore_migrator`, `RESET ROLE` and reviewed membership removal in order.
   Do not rerun the optional `CREATE ROLE` sections over existing roles.

Default privileges belong to the object-creating role. Running
`ALTER DEFAULT PRIVILEGES` as the administrator without selecting the migrator
can succeed while configuring the wrong future owner. `SET ROLE` makes the creator
explicit; it requires actual ability to assume that role. Review any pre-existing
membership before revoking it. If it already exists, prepare a reviewed equivalent
to the template's temporary grant/revoke pair; do not remove unrelated standing access.
A role-creator's provider/PostgreSQL administration membership is separate from
this temporary data-access membership. Inspect actual memberships rather than
claiming that this procedure removes every administrator capability.
See [default privileges](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html).

Supply the two resulting URLs through the deployment's approved secret mechanism.
Native API/worker use `DATABASE_URL`; Compose runtime uses `COMPOSE_DATABASE_URL`.
Compose migrate selects `MIGRATION_DATABASE_URL`, falling back to its runtime URL
if absent. The guarded seed requires an explicit migration URL; restore also uses
the owner URL. Omission is not a supported role-separated migration configuration.

Application/seed/restore and native Prisma CLI use different strict TLS parameters.
Use the [single-host connection settings](single-host-compose.md#3-complete-env)
and its private migration-only override. Do not weaken verification to fix a refusal.
A successful CLI connection alone does not prove certificate or hostname rejection.

Staging and production need their own credentials. Keep the production owner URL
in production's secret scope; never give that production credential to staging or
the running application. See [promotion secrets](production-deploy-profile.md#secrets-and-variables-checklist).

## Adopting this on an existing database

Close affected writers and verify a restorable backup before changing ownership,
roles or connection settings. Inventory the existing owners, grants, memberships
and migration ledger. If schemas already exist, do not recreate them or rerun
migrations merely to transfer ownership; reconcile actual ledger state separately.

`REASSIGN OWNED BY <existing_role> TO amcore_migrator` is a broad administrative
operation. It can affect all objects owned by that role in the current database
and shared objects such as databases/tablespaces, not only AMCore tables.
It does not transfer objects inside other databases, default privileges or grants
on objects the old role does not own. Review the full affected ownership first.
If the old role also owns unrelated resources, prepare a narrower reviewed transfer.

Use a superuser or an administrator with the ownership privileges required for
all affected objects and ability to `SET ROLE` to the new owner. Merely connecting
as the old owner is insufficient. Follow
[PostgreSQL ownership transfer](https://www.postgresql.org/docs/18/sql-reassign-owned.html)
and stop if authority or scope is unknown; do not broaden runtime privileges.

After the reviewed transfer, apply Step3 for current and future objects. Recreate
API/worker connections with the runtime credential. Verify ownership, runtime DML
and sequence use, denial of owner-role assumption, schema DDL and table `TRUNCATE`.
Check default privileges with the disposable-object method in
[role-separated restore verification](backup-restore.md#verify-a-role-separated-restore),
only on an isolated target. Do not add probe tables to production.
Keep traffic closed on any missing grant, unknown ownership or failed verification.

## What this doesn't need

- **A production shadow database.** Production `migrate deploy` and `migrate resolve`
  do not need the development shadow-database create/drop capability.
- **Runtime access to `public._prisma_migrations`.** Migration bookkeeping and
  owner-only maintenance read it; normal application traffic does not need that
  grant. MFA deployment maintenance checks the ledger through its approved owner
  connection. Do not widen the runtime role for maintenance or backups.

## Interaction with other parts of this repo

- The scratch `restore-drill` skips ownership/ACLs. It does not verify restored
  role separation. Use [role-separated restore verification](backup-restore.md#verify-a-role-separated-restore)
  with the actual archive and target capabilities; synthetic fixtures are not that proof.
- Audit-log triggers reject ordinary `UPDATE`/`DELETE`/`TRUNCATE` while enabled.
  They are not protection against a schema owner or superuser who can change or
  disable them. Keep that credential out of runtime. Optional
  `REVOKE UPDATE, DELETE ON core.audit_log FROM amcore_runtime` is additional
  hardening, not a replacement for the trigger or a complete owner threat boundary.

## A backup reader role

The optional template section creates `amcore_backup` with `pg_read_all_data` for
full table/sequence reads, including Prisma's ledger. It grants no write permissions
by itself and does not bypass row-level security. Check other direct/inherited
privileges and any downstream RLS before claiming a complete read-only backup.
Provision this role through an administrator allowed to grant it, set its password
while `NOLOGIN`, then enable login. Set `BACKUP_DATABASE_URL` to this role; do not
widen runtime access. See [PostgreSQL predefined roles](https://www.postgresql.org/docs/18/predefined-roles.html).

## A third role for query investigation

`amcore_observer` is separate from application, migrator and backup credentials.
Its `pg_monitor` grant needs an administrator authorized to delegate that capability;
`CREATEROLE` alone is not proof. Do not grant the runtime role broader query-statistics
access. Follow [the observer guide](pg-stat-statements-observer-role.md) for setup,
security and recovery.

## See also

- [Deployment](deployment.md#migration-contract) — one-shot ordering and recovery.
- [Migration image](migrator-image.md) — exact endpoint, TLS and process contract.
- [Backup & restore](backup-restore.md) — archives, ownership and admission.
- [Secret rotation](secret-rotation.md) — replacing credentials across consumers.
- [Deployment platforms](deployment-platforms.md) — mappings require actual target qualification.
