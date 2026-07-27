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
(`postgres:16-alpine` — no third-party backup image, consistent with this
repo's supply-chain/pin discipline). It targets the same database the app
uses — `COMPOSE_DATABASE_URL` if set, otherwise the bundled `postgres`
service — so it works whether you're on local-infra or a managed/VPS DB.

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
first), not an existing one with unrelated objects in it. Point
`DATABASE_URL`/`COMPOSE_DATABASE_URL` at the intended target before running
it, and never run it against a database you don't intend to overwrite.

### Operational notes

- **Dumps contain full data, including PII.** Apply the same access
  controls to the backup volume/location as to the database itself.
- **Store dumps offsite.** A host-level disaster (disk failure, VPS
  provider outage) takes out both the database and any backups left on the
  same host. Mount the backup volume to network storage, or sync it off-host
  on a schedule.
- **Encrypt dumps at rest** if they leave your infrastructure's trust
  boundary.
- **Test restores periodically**, not just once — the same rule as the
  managed-provider path above.

## Not covered here

- **Object storage** (uploaded files/media under `STORAGE_DRIVER=s3` or the
  `local` driver) is a separate concern from the Postgres backups above.
  Production already requires `STORAGE_DRIVER=s3` (see "Production
  environment requirements" in [deployment.md](deployment.md)) — durability
  for that data is the object-storage provider's responsibility, not this
  guide's.
- **Secret rotation** (JWT secret, OAuth credentials, storage keys) is a
  separate operator runbook and is not covered by this starter guide yet.
- Redis is not covered — it holds queues/cache/rate-limit state, not durable
  application data; see "Redis production profile" in
  [deployment.md](deployment.md) for its persistence (AOF) requirements.
