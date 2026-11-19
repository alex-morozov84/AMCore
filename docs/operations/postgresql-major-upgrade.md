# PostgreSQL Major-Version Upgrade

Move an AMCore deployment between PostgreSQL major versions using a verified
migration. The examples migrate PostgreSQL 16 to PostgreSQL 18. Check storage
layout, role ownership and rollback limits before touching retained data.

## Why this is not just an image-tag change

Swapping `postgres:16-alpine` for `postgres:18-alpine` in
`docker-compose.yml` does not upgrade your data. Two separate facts make
that true:

1. **PostgreSQL itself has no in-place major-version storage
   compatibility.** A PostgreSQL 18 server cannot read a PostgreSQL 16 data
   directory. Moving between majors always requires `pg_dump`/`pg_restore`,
   `pg_upgrade`, or logical replication — never a plain restart against the
   old files.
2. **The official Docker image itself changed its own storage contract in 18.** Images before 18 declare `/var/lib/postgresql/data` as the
   `VOLUME`. From 18 onward, the image declares `/var/lib/postgresql`
   instead (`PGDATA=/var/lib/postgresql/<major>/docker` inside it). Mounting
   an 18+ image at the old `.../data` path fails outright — the container
   refuses to start rather than silently misreading old data:

   ```text
   Error: in 18+, these Docker images are configured to store database data in a
   format which is compatible with "pg_ctlcluster" ...
   there appears to be PostgreSQL data in:
     /var/lib/postgresql/data (unused mount/volume)
   ```

`docker-compose.yml`'s `postgres` service already mounts the new major at
`/var/lib/postgresql` on a **new, distinct volume**
(`postgres_data_pg18`). A retained `postgres_data` volume from an older bundled deployment is not
mounted by that definition. Confirm the actual project, volume names and mounts;
do not delete the source until migration and backup retention permit it.

## Choose your migration path

Not every deployment should use the same mechanism. Pick one:

1. **Managed production database (RDS, Cloud SQL, Neon, Supabase, etc.) —
   use the provider's native major-upgrade mechanism.** Confirm that the provider supports your exact source/target versions,
   extensions, maintenance window and recovery requirements. This guide does
   not establish a provider-specific upgrade or rollback guarantee.
2. **AMCore's bundled Compose stack, or a small self-hosted deployment —
   dump/restore, below.** This is AMCore's own fully runnable path: stock
   official images, the existing `backup`/`restore` compose profiles'
   underlying tools, no new infrastructure. Downtime and temporary disk
   usage are roughly proportional to database size — fine for a starter's
   own reference stack and small deployments, not something to reach for
   with a multi-hundred-GB production database.
3. **Large self-hosted deployment — `pg_upgrade`.** Follow PostgreSQL's own
   [`pg_upgrade` documentation](https://www.postgresql.org/docs/current/pgupgrade.html)
   (`--link`/`--clone`/`--copy` mode as your filesystem permits). Time and disk requirements depend on the selected mode. It needs both
   the old and new major's server binaries available to run it — the stock `postgres:18-alpine` image
   ships only PostgreSQL 18's binaries, so this means either a custom image
   with both majors installed or running `pg_upgrade` outside Docker
   entirely. AMCore does not ship or maintain such an image; this path
   needs its own environment-specific rehearsal before you rely on it.
   `pg_upgrade --link` also hard-links data files between the old and new
   clusters — once the new cluster starts, the old one is no longer safe to
   restart independently. That is a materially different (and less
   forgiving) rollback story than the dump/restore path below, which keeps
   the old cluster completely untouched until you delete it yourself.

The rest of this guide covers path 2 — dump/restore — since it's the one
path AMCore actually ships tooling for.

## Client/server version direction

Use the target major's clients for this migration. PostgreSQL 18 `pg_dump`
can read a PostgreSQL 16 server; PostgreSQL 16 `pg_dump` refuses a PostgreSQL 18
server. Loading output into an older server is not guaranteed.
Use PostgreSQL 18 `pg_restore` to read the resulting archive. Newer archive
formats need a compatible restore client; client/server compatibility alone
is insufficient. See [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

## Before you start

- **Take a fresh, verified backup**, independent of this migration, using
  the existing `backup` compose profile or your normal backup path. Rehearse
  restoring it (`restore-drill`, or your own drill) before the maintenance
  window — see [Backup & restore](backup-restore.md).
- **Declare a write freeze.** Pick a point after which nothing writes to the
  PostgreSQL 16 database — put the application in maintenance/read-only
  mode that blocks every writer, or stop all application services, one-off
  jobs and external writers. Follow the [write-stop sequence](single-host-compose.md#restore-a-database-dump). Hold the freeze through
  the dump, restore, and verification steps below, until you explicitly
  declare cutover complete. The freeze is what makes rollback (see below)
  possible; skipping it does not save real time, since verification still
  has to happen before cutover either way.
- Know which of the two restore paths below applies to you: the **default
  bundled single-role** setup (this repo's out-of-the-box `docker-compose.yml`,
  one `amcore` role), or an **[ADR-076 role-separated](database-role-separation.md)**
  deployment (`amcore_migrator`/`amcore_runtime`/`amcore_observer`). They
  are not interchangeable — using the wrong one either fails outright or
  silently drops the role separation you set up for production.

## Migration procedure

1. **Dump the PostgreSQL 16 source**, using the PostgreSQL 18 client so the
   dump format matches what you'll restore with:

   Prepare a protected libpq password file at `/absolute/private/pgpass` with
   mode 0600. Use the [libpq password-file format](https://www.postgresql.org/docs/18/libpq-pgpass.html)
   for its source host, port, database, user and password; enter values privately.
   Never put the password in command arguments. Replace the network/host/user
   placeholders. Run from a new private backup directory:

   ```bash
   set -eu
   umask 077
   set -C
   docker run --rm --network <your-network> \
     --mount type=bind,src=/absolute/private/pgpass,dst=/run/secrets/pgpass,readonly \
     -e PGPASSFILE=/run/secrets/pgpass \
     postgres:18-alpine \
     pg_dump -Fc -h <pg16-host> -U <source-user> -d amcore \
     > amcore-pg16-migration.dump.tmp
   mv amcore-pg16-migration.dump.tmp amcore-pg16-migration.dump
   ```

   `set -C` refuses an existing temporary output. Choose a fresh directory so
   neither filename already exists. A failed dump must not become the final
   archive; keep the source frozen and inspect the failure before retrying.
   Verify the archive/checksum and retain it with the source revision and
   captured data expectations. Treat dumps as confidential executable inputs.

2. **Boot the isolated PostgreSQL 18 validation target against a fresh, empty volume.**
   For the bundled Compose stack this is exactly the new `postgres` service
   definition, pointed at an empty `postgres_data_pg18` volume (the default
   after this repo's own image bump — nothing extra to configure if you're
   starting from a clean checkout).

3. **Restore, by source-state path:**

   Before either restore, inspect `pg_restore --list amcore-pg16-migration.dump`
   with the PostgreSQL 18 client. Inventory extensions, publications,
   subscriptions and custom roles/ACLs against the prepared isolated target.
   Configure target credentials privately through libpq; confirm the selected
   host, database and role before running destructive commands.

   ### Default bundled single-role Compose

   The fresh PostgreSQL 18 bootstrap already creates the same `amcore` role
   via `POSTGRES_USER` — no roles to provision first.

   ```bash
   pg_restore --no-owner --exit-on-error \
     -h <pg18-host> -U amcore -d amcore \
     amcore-pg16-migration.dump
   ```

   `--no-owner` means restored objects are owned by `amcore`, the role
   you're connecting as — the same role that already owned everything in
   the default single-role setup, so this is not a behavior change, just an
   explicit statement of intent rather than an implied "ownership is
   preserved" (it isn't preserved; it's reassigned to the connecting role,
   which happens to already be correct here).

   ### ADR-076 role-separated deployment

   Cluster roles (`amcore_migrator`, `amcore_runtime`, `amcore_observer`)
   are **not** part of a per-database `pg_dump`. Provision the canonical
   roles explicitly: the restore requires `amcore_migrator` as its target
   role, while the ACL replay is deliberately skipped and rebuilt afterward.

   1. From [`setup-roles.sql`](../../docker/postgres/setup-roles.sql), run
      **Step 1** to create `amcore_migrator` and `amcore_runtime`, then run
      the separate optional-observer block to create `amcore_observer`.
      Follow the script's `NOLOGIN` -> `\password` -> `LOGIN` sequence for
      all three roles; do not run Step 2 or Step 3 yet.
   2. Grant your restore administrator temporary membership with `SET`
      capability in `amcore_migrator`, then restore as that role (replace
      `<admin-user>` in both commands):

      ```sql
      GRANT amcore_migrator TO <admin-user>
        WITH INHERIT FALSE, SET TRUE;
      ```

      ```bash
      pg_restore --role=amcore_migrator --no-owner --no-privileges \
        --exit-on-error \
        -h <pg18-host> -U <admin-user> -d amcore \
        amcore-pg16-migration.dump
      ```

      `--no-privileges` deliberately skips replaying the dump's ACLs —
      those describe the _old_ cluster's roles and would fail the same way
      unqualified `--no-owner` restore does. Whether restore succeeds or fails,
      revoke the temporary membership from the administrator session:

      ```sql
      REVOKE amcore_migrator FROM <admin-user>;
      ```

      Verify that membership was removed before repairing or retrying a failure.
      If the result is unknown, keep ingress closed and inspect membership through
      an authorized administrator; do not continue on an assumed cleanup.

   3. Reapply [`setup-roles.sql`](../../docker/postgres/setup-roles.sql)
      **Step 3** through the restore administrator to recreate the canonical
      runtime grants and default privileges against the now-restored objects.
      The script itself takes temporary membership, switches to the migrator
      role, and revokes that membership afterward; do not run the wrapper as
      an already-set `amcore_migrator` session. This _replaces_ Step 2 of the
      normal onboarding flow (which assumes `prisma migrate deploy` created
      the objects) — do not also rerun the historical migration history over
      already-restored objects. After any wrapper outcome, verify that its
      temporary membership was removed too. If the wrapper fails, disconnects
      or leaves an unknown outcome, keep ingress closed. Inspect and remove
      retained temporary membership through a fresh authorized administrator
      session before repair or retry; never assume the wrapper reached cleanup.
   4. Provision `pg_stat_statements` and `pg_monitor` for `amcore_observer`
      separately, following [Bootstrap](pg-stat-statements-setup.md) and
      [the `amcore_observer` role](pg-stat-statements-observer-role.md) —
      a per-database dump carries neither the extension's preload state nor
      cluster role memberships.
   5. **A fork with additional roles, ACLs, row-level-security policies,
      extensions, or provider-owned objects beyond this repo's own
      `amcore_migrator`/`amcore_runtime`/`amcore_observer` model must
      inventory and migrate those explicitly.** This procedure only
      promises to reconstruct AMCore's own canonical three-role setup, not
      whatever a specific downstream product added on top of it.

   If either restore fails, keep all product writers blocked. The target can be
   partly restored; an error exit does not undo earlier statements. Preserve the
   source, archive and independent backup. Correct the cause, verify the target's
   identity/ownership, then discard and recreate only that disposable PostgreSQL18
   target with fresh empty storage. Reprovision its required roles/prerequisites
   and repeat restoration. Never remove the source or its backup volume, retry
   over partial data, or run migrations/seed to hide a failed restore.

4. **Verify on a validation copy — before cutover, not after.** The database
   you restored in steps 2 and 3 is the _validation copy_. Never cut over to
   it: step 5 makes its own restore, because the checks below write test
   data.

   1. **Compare data with the frozen source** before any application starts:
      - Schema and table inventory match: `\dn`, `\dt` on both sides.
      - Per-table row counts (or a documented checksum) match. Counts alone
        cannot show that values match: also compare a few known source
        values captured during the freeze (a known account, organization and
        membership are enough).
      - The migration history table matches: same migration names and
        checksums, all finished, none rolled back.
      - Extensions present on the source are present and correctly versioned.
      - Sequence current values match (`pg_sequences`; the AMCore schema
        has no sequences, a product may).
      - **Default/bundled path:** all objects are owned by `amcore`.
      - **Role-separated path:** application objects are owned by
        `amcore_migrator`; default table/sequence privileges are recorded for
        future `amcore_migrator`-created objects; `amcore_runtime` succeeds at
        ordinary DML and fails DDL/privilege-escalation attempts (use uniquely
        named disposable tables, remove only those afterwards, and never run
        these probes after ingress is open);
        `amcore_observer` cannot read application tables but does have the
        intended `pg_monitor` membership and can read the documented
        statistics surface; neither `amcore_runtime` nor `amcore_migrator` can
        execute `pg_stat_statements_reset` (only the separately authorized
        recovery path can — see [Recovery](pg-stat-statements-recovery.md)).
   2. **Start the matching application against the validation copy:** the same
      API and worker images you will run after cutover, no new migration (the
      restored database already holds the full history; do not run migrations
      against it), a private network with no public ingress, its own empty Redis
      (never the production Redis: a validation worker would take real queued
      jobs and write sessions into the live store; in the bundled Compose stack
      the `redis` service is that production Redis, so start a separate Redis
      container for the validation copy), and external effects disabled or
      mocked (for example `EMAIL_PROVIDER=mock`; no production provider keys). A
      changed `DATABASE_URL` alone proves nothing: check each process's real
      connection on the validation database (`pg_stat_activity`: its
      `datid`/`datname` and the client address).
   3. **Exercise it:** sign in with a dedicated test or staff account that
      existed before the migration (operators do not know users' passwords);
      read data that existed before it (profile, organization); write one
      disposable record (for example register a new account) and read it back;
      run one background job whose effect is mocked and wait for it to complete.
      Then repeat the data comparison from step 4.1 for the data that existed
      before: it must be unchanged.
   4. **Stop these processes and discard the validation copy** (drop its
      database, or remove its scratch instance and volume). Expected
      result: every comparison and exercise passed with no reset or reseed.
      Any failure or unknown result means do not cut over: find the cause
      with the source still frozen.

   A fresh-database test or e2e run does not replace this step. It proves the
   code against a database created by the current migrations, not a restored
   copy of your data. Verify the application has passed its required regression tests on supported
   fixtures. Reuse applicable accepted results; only the restored copy shows
   whether your data and the application work together.

5. **Cut over.** Only once every check in step 4 passed:

   1. **Restore the same dump again, following step 3, into a separate,
      empty PostgreSQL 18 database** — the cutover database. For the bundled
      Compose stack, step 4.4 removed the validation volume: recreate the
      `postgres` service with a new empty `postgres_data_pg18` volume and
      restore into it (this path was not rehearsed). Then repeat the
      comparison from step 4.1 on it. If it differs, start no application:
      discard this database, find the cause (the dump, the restore command,
      the target) and restore again. Do not reuse the validation copy.
      Verify the actual isolated cutover target separately, including existing
      owners/grants/default privileges. Use the
      [isolated role probes](backup-restore.md#verify-a-role-separated-restore)
      before opening ingress. Use uniquely named disposable tables/sequences,
      remove only those probes as owner and recompare original data/history/sequence
      evidence. A passing validation copy does not certify the final target. Unknown
      cleanup or comparison keeps ingress closed; repair or rebuild that target.

   2. **Keep ingress and every writer to the source closed** until the end
      of this step. Once the new processes start (step 5.4), do not return
      to the source.
   3. **Save the new connection settings and recreate every process that
      connects to the database:** API, worker, and any backup or maintenance
      client you run. A restart alone does not change a saved URL. For the
      bundled Compose stack, point `docker-compose.yml` at the new PostgreSQL
      18 service and volume (see "What was rehearsed": this swap was not
      covered).
      Remove the old API and worker containers; no process may stay connected
      to the source (`pg_stat_activity` on the source server shows no client
      connections).
   4. **Start the new processes and confirm their real connections** are to
      the cutover database, as in step 4.2. They use the deployment's own
      Redis, which may hold queued jobs: a job that runs now can have an
      external effect, so count it in step 5.5. In this reference setup the web
      app has no database connection; do not change its settings for this
      step.
   5. **Check readiness and run one controlled canary** on the private
      network: sign in, read, and write one disposable record. Note the time of
      the first start, because it marks the rollback boundary:
      from the first start of the application against the cutover database,
      follow
      [Rollback boundary](#rollback-boundary--read-this-before-you-start-writing-to-pg18).
      If any check fails or its result is unknown, keep ingress closed and
      fix forward. Discard the cutover database and repeat from the restore
      only if no real user wrote data (your own canary record does not
      count) and no external effect happened (no real email, no provider
      call); otherwise keep it and repair forward.
   6. **Open ingress and lift the write freeze.** Take a first backup of the
      new database and confirm it completes.

### What was rehearsed

The procedure above was run end to end once, on PostgreSQL 16.15 to PostgreSQL
18.6 (arm64), with a small synthetic data set: the default single-role setup,
API and worker started as containers with a changed `DATABASE_URL`, one instance
per role, the mock email provider and no web app, and a scratch Redis replaced
by a new empty one before cutover; a Redis that holds queued jobs or sessions
was not part of it. The restored copy and the separate cutover database passed
their checks; the first backup afterwards completed (it was not restored or
verified). It did **not** cover the bundled Compose volume swap under the same
hostname, the role-separated restore together with the application, several
replicas of one role, other extensions or providers, large databases or other
CPU architectures. Rehearse those for your deployment before relying on them.

## Rollback boundary — read this before you start writing to PG18

Rolling back by simply pointing back at the untouched PostgreSQL 16 volume
is safe **only while the write freeze from "Before you start" still holds**
— that is, only before the first start of the API or worker against the
cutover database. Restoring the dump, the comparisons and the role probes do
not count.

That first start counts as the write (step 5.4): a sign-in creates a session,
and worker startup may write. The validation copy in step 4 is a different
database, discarded before cutover, and does not cross the boundary.

**Once PostgreSQL 18 accepts writes, there is no supported downgrade
rollback.** PostgreSQL gives no guarantee that dump output from a newer
major loads into an older one, so reverting to the PostgreSQL 16 volume
after real post-cutover writes exist would silently discard every one of
those writes — and the reverse dump/restore direction may not even be
possible. If you need to undo a cutover after writes have landed, that
requires a forward-fix or a separately designed and rehearsed reverse data
path; this runbook intentionally does not attempt to automate that case.

This is a deliberate, named limitation, not an oversight: every realistic
major-upgrade runbook has the same constraint once writes cross the
boundary, and pretending otherwise would be a false safety promise.

## See also

- [Backup & restore](backup-restore.md) — the ongoing backup strategy this
  migration's own dump step borrows from, and the `restore-drill` profile
  that rehearses a restore on a schedule.
- [Database role separation](database-role-separation.md) — the
  `amcore_migrator`/`amcore_runtime`/`amcore_observer` model the
  role-separated restore path above reconstructs.
- [Deployment & migrations](deployment.md) — where this fits in a
  production rollout.
