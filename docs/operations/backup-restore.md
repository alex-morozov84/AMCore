# Backup & Restore

Postgres is this starter's system of truth — users, organizations, auth,
audit log, notifications, AI conversation history, and more all live there.
Losing it without a way back is a data-loss incident, not an inconvenience.
This guide has three parts: which backup strategy fits your deployment, the
optional compose `backup`/`restore` profiles this repo ships, and what's
deliberately out of scope.

## Which strategy fits your deployment

### Managed database (recommended default)

If you run Postgres on a managed provider (RDS, Cloud SQL, Neon, Supabase,
etc.), use the provider's own backups — this is almost always the right
choice: continuous WAL archiving, tested restore tooling, and no extra
operational burden on you.

- Enable automated backups / point-in-time recovery (PITR) in the provider
  console.
- Set the retention window to match your RPO (recovery point objective —
  how much data loss is acceptable), e.g. 7–35 days.
- **Test the restore path at least once.** Restore a snapshot to a scratch
  instance, point `DATABASE_URL` (or `COMPOSE_DATABASE_URL`) at it, and
  confirm the app boots and reads real data. An untested backup is not a
  backup.

### Self-hosted production (real PITR)

If you run Postgres yourself in production — not just the compose-bundled
instance below — a periodic dump only gives you a snapshot at dump time; a
crash between dumps loses everything since the last one. For real
point-in-time recovery, set up continuous WAL archiving:

- [pgBackRest](https://pgbackrest.org/) — full/incremental/differential
  backups, parallelism, backup validation, retention policies. The more
  complete option.
- [WAL-G](https://github.com/wal-g/wal-g) — simpler, S3/GCS-native archiving.

Configuring either is environment-specific (archive destination, retention,
restore drill) and out of scope for what this starter ships — treat this
section as the pointer to what "production-grade self-hosted Postgres"
requires. Don't rely on the logical-dump profile below for that.

### Logical dump (small/self-hosted only) — the compose `backup`/`restore` profiles

For a small self-hosted deployment (e.g. a single VPS running the reference
`docker-compose.yml`) where PITR infrastructure is overkill, this repo ships
optional compose profiles that take periodic `pg_dump` snapshots.

**Honesty caveat: a logical dump is not point-in-time recovery.** It captures
data only at the moment the dump ran — anything written between the last dump
and a failure is lost. Use this when that RPO is acceptable (dev/staging, or
a low-write hobby deployment), or as a defense-in-depth supplement alongside
real PITR — never as your sole backup strategy for anything that matters.

## Using the compose backup/restore profiles

### Enable scheduled backups

Add `backup` to `COMPOSE_PROFILES` (alongside `local-infra` and/or `edge`):

```bash
COMPOSE_PROFILES=local-infra,backup
docker compose up -d backup
```

The `backup` service runs on the same image family as the reference stack
(`postgres:18-alpine` — no third-party backup image, consistent with this
repo's supply-chain/pin discipline). It targets the same database the app
uses — `COMPOSE_DATABASE_URL` if set, otherwise the bundled `postgres`
service — so it works whether you're on local-infra or a managed/VPS DB.
With [role separation](database-role-separation.md) the runtime role cannot read
Prisma's history table, so the dump fails; set `BACKUP_DATABASE_URL` to the
read-only [backup reader role](database-role-separation.md#a-backup-reader-role).

**This is an interval, not a wall-clock schedule.** `BACKUP_INTERVAL_SECONDS`
(default `86400`, i.e. once a day) is how long the container sleeps between
dumps — it counts from container start, not from midnight. There is no
"run at 03:00 daily" cron here; if you need a specific time of day, restart
the `backup` service at that time (e.g. via your host's own cron/systemd
timer running `docker compose restart backup`) or replace this profile with
a real scheduler. After each dump, it also prunes any `amcore-*.dump` older
than `BACKUP_RETENTION_DAYS` (default `7`).

### Where dumps are stored

Dumps are written to `/backups` **inside the container**, backed by the
named Docker volume `postgres_backups` (declared in `docker-compose.yml`,
shared by both the `backup` and `restore` services). The `/backups` path is
fixed in the scripts — there's no env var for it — but the **volume itself**
is a normal Compose volume, so you can point it anywhere Docker volumes
support: a bind mount to a host directory, or a directory synced to network
storage. For example, to bind-mount to a host path instead of a Docker-managed
volume, override the `postgres_backups` volume in a
[Compose override file](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/):

```yaml
volumes:
  postgres_backups:
    driver: local
    driver_opts:
      type: none
      device: /path/to/offsite/mount
      o: bind
```

See "Store dumps offsite" below for why you'd want to.

### Logs

The `backup` and `restore` services log to their container's stdout/stderr
(`[backup] <timestamp> starting/completed/FAILED ...`) — there is no
separate log file and no log rotation beyond whatever your Docker log driver
is configured to do. View them with:

```bash
docker compose logs -f backup
```

### Restore

Restore is a **one-shot**, like the `migrate` service — it never runs on a
normal `docker compose up`. It requires its own profile _and_ an explicit
`run`, so it cannot fire by accident:

```bash
docker compose --profile restore run --rm restore <dump-filename>
```

This is destructive by design for every object the dump contains
(`pg_restore --clean --if-exists` drops and recreates each one) — but it is
**not** a full database wipe: objects that exist in the target and aren't in
the dump are left untouched. If you need a clean replacement, restore into
an empty/scratch database (or drop and recreate the target database/schema
first), not an existing one with unrelated objects in it. The service connects
with `MIGRATION_DATABASE_URL` when it is set (the owner role that can drop and
recreate objects under [role separation](database-role-separation.md)), otherwise
with `COMPOSE_DATABASE_URL`. Point it at the intended target before running
it, and never run it against a database you don't intend to overwrite.

### Restore-drill (rehearsing a restore, not just taking one)

**A backup nobody has restored is not a verified backup.** GitLab's own
public postmortem of its January 2017 database incident is the canonical
example of why: they had four separate backup/replication mechanisms in
place (a daily `pg_dump` to S3, a daily LVM snapshot, disk snapshots for
other servers, and Postgres replication), and none of them were usable when
the incident hit. The `pg_dump`-based backups turned out not to exist at
all — a Postgres major-version mismatch between the backup tooling (9.2) and
production (9.6) had been silently making every dump fail — so recovery fell
back to a manual snapshot taken about six hours before the outage, and
copying that data back took roughly 18 hours. Every one of those failures
was findable in advance by simply trying a restore.
([GitLab's postmortem](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/))

The `restore-drill` profile automates exactly that check for the logical-dump
fallback above — it is **not** available for managed-provider PITR or
self-hosted WAL archiving, which have their own vendor/tool-specific restore
verification:

```bash
docker compose --profile restore-drill run --rm restore-drill
```

It mounts backups read-only and restores the selected archive into a temporary
Postgres instance under `/tmp`, using only a Unix socket with Docker networking disabled. It never reads a live
database URL. The container's `/var/lib/postgresql` mount is temporary too; the
drill leaves no database volume. Allow disk/CPU/IO for a full database copy.

The default structural check requires `core.users`, `core.organizations`,
`core.org_members` and a completed, well-formed migration history. Empty business
tables are valid. A ledger-only archive or unresolved migration fails. A fork that
changes these relations must deliberately replace the read-only mounted
`/scripts/restore-baseline.sql`; keep the lifecycle script unchanged.

Structural success does not prove row correctness, exact migration compatibility,
or ownership/ACL restoration. The scratch cluster skips owners and grants because
it has none of the original roles. Verify the actual target separately below.

For selected-data proof, choose an explicit dump and a protected assertion file:

```sh
docker compose --profile restore-drill run --rm --no-deps \
  --volume /absolute/private/expected.sql:/checks.sql:ro \
  restore-drill <dump-filename> /checks.sql
```

Capture expectations from the source **before backup, during the same write pause**.
Keep them off-host beside the dump, source revision and file/archive checksums.
Assertions derived only from the restored data cannot detect missing source data.
Use trusted SQL that raises an error on mismatch, for example:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM core.users WHERE id = '<expected-user-id>') THEN
    RAISE EXCEPTION 'Expected user missing';
  END IF;
END $$;
```

Replace the placeholder in the private file with the recorded synthetic/user fact.
Add expected organization membership, selected field values and exact migration
names/checksums for your recovery goal. Assert zero explicitly when zero is expected.
`SELECT false` and a query returning no rows do **not** signal failure.
The drill runs `psql -X` with `ON_ERROR_STOP` and a read-only transaction. Requested
missing/empty SQL or missing explicit dump fails; no fallback to another archive.
SQL and archives are trusted executable inputs, not a hostile-code sandbox.
Keep them mode 0600 in a private directory; normal verdicts need no user-row output.

Output distinguishes structural success from selected-data assertion success.
Without assertions, it prints `selected-data assertions NOT REQUESTED`. Neither
verdict certifies all business data or target permissions. Scheduled backups keep
their existing format; assertion files are optional, operator-owned evidence.

**Run it on a schedule, not just once.** Like the `backup` service, this
profile has no built-in wall-clock scheduler — wire it to your host's own
cron or systemd timer. A monthly cadence is a reasonable starting point for
most deployments; tighten it if your RPO tolerance is smaller:

```cron
# /etc/cron.d/amcore-restore-drill — 1st of the month, 04:00
0 4 1 * * root cd /path/to/amcore && docker compose --profile restore-drill run --rm restore-drill || echo "amcore restore-drill FAILED" | mail -s "AMCore restore-drill failed" ops@example.com
```

Adapt the failure action to however you already page/alert — the important
part is that a failed drill produces a signal an operator sees, not a line
buried in `docker compose logs`.

### Verify a role-separated restore

The generic drill above skips owners and ACLs. Rehearse your actual archive on an
isolated, empty target before restoring production. Provision the original owner
and runtime roles there using [database role separation](database-role-separation.md).
Use an authorized restore administrator that can restore ownership to those roles;
the application runtime credential cannot do this. Keep production writers away
from this target and supply credentials through the normal secret mechanism.

With libpq connection settings selecting only that isolated target, restore the
archive without `--no-owner` or `--no-privileges`:

```sh
pg_restore --exit-on-error --dbname="${PGDATABASE:?select the isolated target database}" /absolute/path/to/verified.dump
```

Require `PGDATABASE` and the other connection settings to identify the empty
target explicitly before running the command. A refusal is a failed drill; do
not disable ownership/ACL restoration to obtain a pass. Reapply the reviewed
step3 grants/default privileges from `docker/postgres/setup-roles.sql` on the
restored target. Do not rerun its CREATE ROLE section over existing roles.

Verify the expected application schema/table/sequence owners, runtime DML and
sequence use, denied DDL/TRUNCATE/SET ROLE, migration ledger/checksums and selected
business rows against your backup evidence. A restored table count is insufficient.
Check future-object default privileges as well as existing grants. Fix any gap
before traffic resumes. On this isolated target, create a uniquely named disposable
table with a generated sequence as the migrator role in each application schema.
Without object-specific grants, connect as runtime and verify inserts, reads and
sequence use; verify the same DDL/TRUNCATE/SET ROLE denials. Remove the probes as
the migrator after inspection. Never run these probes on the production target.
Unknown provider-specific restore permissions require capability verification on
the isolated target; do not infer them from `CREATEROLE` alone.
The [migration operations test](migrator-image.md#verify-roles-tls-history-and-recovery)
exercises this contract on its own synthetic data; it does not read or certify
your archive. Managed PITR and WAL restores need the equivalent provider-specific drill.

### Operational notes

- **Dumps contain full data, including PII.** Apply the same access
  controls to the backup volume/location as to the database itself.
- **Store dumps offsite.** A host-level disaster (disk failure, VPS
  provider outage) takes out both the database and any backups left on the
  same host. Mount the backup volume to network storage, or sync it off-host
  on a schedule.
- **Encrypt dumps at rest** if they leave your infrastructure's trust
  boundary.
- **Test restores periodically**, not just once — see "Restore-drill" above
  for the logical-dump path's automated check; managed-provider PITR and
  self-hosted WAL archiving need their own restore-drill equivalent using
  their own tooling.

## Not covered here

- **Object storage** (uploaded files/media under `STORAGE_DRIVER=s3` or the
  `local` driver) is a separate concern from the Postgres backups above.
  Both S3-compatible and local storage are supported in production. Provider
  durability does not replace an operator retention/recovery policy; configure
  versioning or backups appropriate to the selected backend. For a local
  deployment, follow [Local file storage](#local-file-storage) below.
- **Secret rotation** (JWT secret, database/Redis credentials, OAuth
  credentials, storage/AI provider keys) is a separate operator runbook — see
  [Secret rotation](secret-rotation.md).
- **Moving to a new PostgreSQL major version** is a distinct procedure from
  routine backup/restore, even though it reuses the same `pg_dump`/
  `pg_restore` tools — see [PostgreSQL major-version
  upgrade](postgresql-major-upgrade.md).
- Redis is not covered — it holds queues/cache/rate-limit state, not durable
  application data; see "Redis production profile" in
  [deployment.md](deployment.md) for its persistence (AOF) requirements.

## AMCore API keys

Before restored traffic resumes, replay trusted post-backup API-key revocations
or invalidate restored credentials. A pre-revoke verifier backup can revive a
key; see [API-key restore safety](api-key-lifecycle.md#restore).

## Local file storage

For `STORAGE_DRIVER=local`, recover the database and shared `local_storage` volume
from one write pause. The volume contains `objects/`, `meta/` and `public/`;
public keys already start `public/`, so public copies can live under
`public/public/`. Preserve that nesting. PostgreSQL dumps do not include these files.

### Capture a recovery set

1. Record the deployment revision and matching images. Prepare known data: a user,
   organization/member, authenticated private file and public avatar. Use the existing
   [private artifact upload/download](../ai/artifacts.md) without creating a run or
   contacting an AI provider, and [account avatar](../media/README.md#avatar-flow-the-shipped-example) controls.
2. Close ingress and drain/stop web, API, worker, backup and all custom writers.
   Verify no writer remains. Only then record expected rows, file hashes/metadata
   and DB file references in a protected directory. Keep writers stopped while
   recording these expectations and capturing both database and files. File objects,
   sidecars and public copies are separate writes; a live tar is not consistent.
3. Take a one-shot DB dump through the existing restore service with the owner URL:

   ```sh
   docker compose --profile restore run --rm --no-deps --entrypoint sh restore \
     -c 'set -eu; umask 077; test ! -e /backups/recovery.dump; test ! -e /backups/recovery.dump.tmp; pg_dump --dbname="$DATABASE_URL" -Fc -f /backups/recovery.dump.tmp; mv /backups/recovery.dump.tmp /backups/recovery.dump'
   ```

   Use a new recovery filename/directory; never overwrite your only good copy.
   Capture migration names/checksums from the source and compare them after recovery.

4. Resolve the actual `local_storage` mount from the recorded API container with
   `docker inspect`; confirm its project and volume labels with `docker volume inspect`.
   Do not guess the project prefix. Create an empty private host backup directory:

   ```sh
   mkdir -m 700 /absolute/private/recovery-set
   sh scripts/recovery-files.sh backup <project> <actual-volume> /absolute/private/recovery-set
   ```

   The helper refuses a missing/foreign volume or running volume consumer before
   mounting. It supports Compose-owned `local_storage`, regular files/directories
   and ASCII letters/digits/`_./-` names. Links/devices/hard links and other names
   are refused. It uses the reference Postgres 18 Alpine tar, excludes only
   `objects/.amcore-probes/` and `meta/.amcore-probes/`, and refuses existing output.

5. Export the dump from the backup volume into the same private host directory:

   ```sh
   docker compose --profile restore run --rm --no-deps \
     --volume /absolute/private/recovery-set:/export \
     --env EXPORT_UID="$(id -u)" --env EXPORT_GID="$(id -g)" \
     --entrypoint sh restore -c '
       set -eu; umask 077
       test ! -e /export/database.dump
       cp /backups/recovery.dump /export/database.dump
       cd /export; sha256sum database.dump > database.dump.sha256
       chown "$EXPORT_UID:$EXPORT_GID" database.dump database.dump.sha256
     '
   ```

   The file helper also gives its archive/checksum to the invoking host user.
   Keep protected assertions, migration checksums and revision/image identity here.
   Copy this directory to your prepared private off-host destination over SSH.
   There, run `sha256sum -c database.dump.sha256 local-files.tar.sha256` before
   deleting any source data. Restrict access and encrypt off-host copies according
   to your backup policy. A checksum detects damage; trust the original set.

### Restore while closed

1. Verify the intact off-host set. Select an empty, isolated target with original
   roles and matching artifacts. Follow the single-host
   [recovery admission order](single-host-compose.md#restore-a-database-dump).
   Decide Redis/queue/credential reconciliation before reopening; DB/files alone
   do not restore queues or prevent replay of outside effects.
2. Copy the verified set to a private directory on the isolated target. If the
   selected dump already exists in its backup volume, compare its SHA-256 with
   the exported `database.dump` and skip import. Otherwise import without overwrite:

   ```sh
   docker compose --profile restore run --rm --no-deps \
     --volume /absolute/private/recovery-set:/import:ro --entrypoint sh restore -c '
       set -eu; umask 077
       test ! -e /backups/recovery.dump
       cp /import/database.dump /backups/recovery.dump
     '
   docker compose --profile restore run --rm --no-deps restore recovery.dump
   ```

   Use the target's saved configuration and an explicitly verified database URL.
   Do not start migrations, seed or application services. Verify selected rows,
   migration names/checksums and [target role/grant behavior](#verify-a-role-separated-restore).

3. Preserve source data/backups. On a new isolated target, create stopped application
   containers and their named volumes from the matching prepared images:

   ```sh
   docker compose create --no-build api worker
   ```

   This can create stopped dependency containers; it starts no process. Do not run
   `up` before validation. Inspect the API container's actual storage mount and the
   volume labels. The destination must be empty. With every consumer stopped, run:

   ```sh
   sh scripts/recovery-files.sh restore <project> <actual-empty-volume> /absolute/private/recovery-set
   ```

   The helper verifies the checksum, bounded paths/types and empty target before
   extraction, then restores uid/gid 1001 access
   with directories 0750 and files 0640. It never mounts the archive writable.
   A validation refusal writes nothing. An I/O/extraction failure can leave a partial
   target: keep writers stopped, discard/recreate **only that owned disposable target**,
   and retry from the intact off-host set. Never retry over partial files.

4. Compare bytes, metadata, public copies and DB references before starting ordinary
   writers. After credential reconciliation and ordered startup, verify authenticated
   private download, unauthorized-private refusal, public avatar and API/worker I/O.
   Recreate only the application containers and verify persistence again. A failed
   check keeps ingress closed. A successful storage health probe alone is insufficient.

This procedure demonstrates a coordinated DB/files recovery point. It does not
implement PITR, S3 recovery, Redis backup, post-backup session revocation or universal
message replay safety. See [local production storage](../storage/configuration.md#local-production).
