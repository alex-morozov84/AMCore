# PostgreSQL Major-Version Upgrade

How to move an AMCore deployment from one PostgreSQL major version to
another — for example, from the PostgreSQL 16 this starter originally
shipped on to the PostgreSQL 18 it ships on now. Read this before touching
any real data; the storage-format and role/ACL details below are not
optional.

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
(`postgres_data_pg18`). Your existing `postgres_data` volume (PostgreSQL 16
data) is never touched, repointed, or read by the new service definition —
it sits there, inert, until you either migrate it (below) or deliberately
remove it once you've confirmed you no longer need it.

## Choose your migration path

Not every deployment should use the same mechanism. Pick one:

1. **Managed production database (RDS, Cloud SQL, Neon, Supabase, etc.) —
   use the provider's native major-upgrade mechanism.** Every major managed
   provider has a rehearsed, supported in-place or blue/green major-upgrade
   path with its own PITR/rollback contract. Prefer it over anything below;
   it's tested at a scale and frequency this repo cannot replicate.
2. **AMCore's bundled Compose stack, or a small self-hosted deployment —
   dump/restore, below.** This is AMCore's own fully runnable path: stock
   official images, the existing `backup`/`restore` compose profiles'
   underlying tools, no new infrastructure. Downtime and temporary disk
   usage are roughly proportional to database size — fine for a starter's
   own reference stack and small deployments, not something to reach for
   with a multi-hundred-GB production database.
3. **Large self-hosted deployment — `pg_upgrade`.** Follow PostgreSQL's own
   [`pg_upgrade` documentation](https://www.postgresql.org/docs/current/pgupgrade.html)
   (`--link`/`--clone`/`--copy` mode as your filesystem permits). It's
   materially faster and avoids doubling disk usage during the migration
   window, at the cost of needing both the old and new major's server
   binaries available to run it — the stock `postgres:18-alpine` image
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

`pg_dump`/`pg_restore` from a **newer** major can dump/restore against an
**older** server. The reverse does not work: a PostgreSQL 16 client cannot
dump a PostgreSQL 18 server, and dump output is never guaranteed to load
into an _older_ major than the one that produced it. Always run the
migration's dump step using the **new** major's client (the `postgres:18-alpine`
image, same as this guide's examples) against the **old** (PostgreSQL 16)
server.

## Before you start

- **Take a fresh, verified backup**, independent of this migration, using
  the existing `backup` compose profile or your normal backup path. Rehearse
  restoring it (`restore-drill`, or your own drill) before the maintenance
  window — see [Backup & restore](backup-restore.md).
- **Declare a write freeze.** Pick a point after which nothing writes to the
  PostgreSQL 16 database — put the application in maintenance/read-only
  mode, or simply stop the `api`/`worker` services. Hold the freeze through
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

   ```bash
   docker run --rm --network <your-network> \
     -e PGPASSWORD=<source-password> \
     postgres:18-alpine \
     pg_dump -Fc -h <pg16-host> -U <source-user> -d amcore -f /dev/stdout \
     > amcore-pg16-migration.dump
   ```

   (Adjust host/network/credentials to your actual topology — the bundled
   `backup` compose profile's `docker/postgres/backup.sh` is a template for
   a scheduled dump; this is a one-shot migration dump, not the scheduled
   loop.)

2. **Boot a scratch PostgreSQL 18 instance against a fresh, empty volume.**
   For the bundled Compose stack this is exactly the new `postgres` service
   definition, pointed at an empty `postgres_data_pg18` volume (the default
   after this repo's own image bump — nothing extra to configure if you're
   starting from a clean checkout).

3. **Restore, by source-state path:**

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
   are **not** part of a per-database `pg_dump` — provision them first, or
   the restore fails on every `GRANT ... TO amcore_runtime` statement the
   dump contains.

   1. Run [`setup-roles.sql`](../../docker/postgres/setup-roles.sql) **Step
      1 only** (role creation, `NOLOGIN`, no passwords yet) against the
      fresh PostgreSQL 18 cluster.
   2. Grant your restore administrator temporary membership (with `SET`
      capability) in `amcore_migrator`, then restore as that role:

      ```bash
      pg_restore --role=amcore_migrator --no-owner --no-privileges \
        --exit-on-error \
        -h <pg18-host> -U <admin-user> -d amcore \
        amcore-pg16-migration.dump
      ```

      `--no-privileges` deliberately skips replaying the dump's ACLs —
      those describe the _old_ cluster's roles and would fail the same way
      unqualified `--no-owner` restore does. Revoke the temporary
      `amcore_migrator` membership once the restore completes.

   3. Reapply [`setup-roles.sql`](../../docker/postgres/setup-roles.sql)
      **Step 3** as `amcore_migrator` to recreate the canonical runtime
      grants and default privileges from scratch, against the now-restored
      objects. This _replaces_ Step 2 of the normal onboarding flow (which
      assumes `prisma migrate deploy` created the objects) — do not also
      rerun the historical migration history over already-restored objects.
   4. Provision `pg_stat_statements` and `pg_monitor` for `amcore_observer`
      separately, following [Bootstrap](pg-stat-statements-setup.md) and
      [the `amcore_observer` role](pg-stat-statements-observer-role.md) —
      a per-database dump carries neither the extension's preload state nor
      cluster role memberships.
   5. Inspect the dump's table of contents (`pg_restore --list
amcore-pg16-migration.dump`) for extensions, publications,
      subscriptions, or other cluster-dependent entries beyond the
      standard three-role model before restoring, rather than letting
      `--exit-on-error` discover an avoidable conflict partway through.
   6. **A fork with additional roles, ACLs, row-level-security policies,
      extensions, or provider-owned objects beyond this repo's own
      `amcore_migrator`/`amcore_runtime`/`amcore_observer` model must
      inventory and migrate those explicitly.** This procedure only
      promises to reconstruct AMCore's own canonical three-role setup, not
      whatever a specific downstream product added on top of it.

4. **Verify before declaring cutover — not after:**

   - Schema/table inventory matches: `\dn`, `\dt` on both source and
     target.
   - Per-table row counts (or a documented checksum) match.
   - Sequence current values match (`pg_sequences`).
   - Extensions present on the source are present and correctly versioned
     on the target.
   - **Default/bundled path:** all objects are owned by `amcore`.
   - **Role-separated path:** application objects are owned by
     `amcore_migrator`; default table/sequence privileges are recorded for
     future `amcore_migrator`-created objects; `amcore_runtime` succeeds at
     ordinary DML and fails DDL/privilege-escalation attempts;
     `amcore_observer` cannot read application tables but does have the
     intended `pg_monitor` membership and can read the documented
     statistics surface; neither `amcore_runtime` nor `amcore_migrator` can
     execute `pg_stat_statements_reset` (only the separately authorized
     recovery path can — see [Recovery](pg-stat-statements-recovery.md)).
   - Run the full application test/e2e suite against the restored PostgreSQL
     18 target before enabling writes.

5. **Declare cutover.** Only once every check above passes: point
   `docker-compose.yml` (or your production configuration) at the new
   PostgreSQL 18 service/volume, lift the write freeze, and resume normal
   operation.

## Rollback boundary — read this before you start writing to PG18

Rolling back by simply pointing back at the untouched PostgreSQL 16 volume
is safe **only while the write freeze from "Before you start" still holds**
— that is, only _before_ PostgreSQL 18 has accepted a single write.

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
