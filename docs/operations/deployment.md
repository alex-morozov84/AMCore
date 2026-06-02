# Deployment & Migrations

How to take AMCore from clone → migrated schema → running app, locally and in
production. The canonical decision is recorded internally as ADR-040.

## Migration contract

- The app **never migrates itself.** Schema changes are applied by a **one-shot**
  `prisma migrate deploy` step, **before** the app (and any workers) start.
- Migrations never run on app startup and never per-replica — that races N
  replicas and can hang on Prisma's advisory lock behind a connection pooler.
- Production uses `migrate deploy` only. `migrate dev` and `db push` are
  development commands and must not be used against a production database.
- Migrations should use a **direct** DB connection, not a PgBouncer/pooled
  endpoint. Set `MIGRATION_DATABASE_URL` when app traffic is pooled; otherwise the
  step uses the same DB URL as the app.

## Requirements

- Docker Compose **v2.20.2+** (`depends_on: { required: false }` and
  `service_completed_successfully`). Use `docker compose` (v2), not the legacy
  `docker-compose` binary.

## Reference stack: `docker-compose.yml`

One env-driven file serves both local and managed/cloud infrastructure. Bundled
Postgres + Redis sit behind the `local-infra` profile; `api`/`web`/`migrate` are
always present. The switch is `COMPOSE_PROFILES` in `.env`. The Docker stack reads
its DB/Redis from `COMPOSE_DATABASE_URL` / `COMPOSE_REDIS_URL` (default: bundled
services), kept separate from the host `DATABASE_URL` / `REDIS_URL` used by
`pnpm dev`, so a host `.env` cannot misconfigure the containers.

### Local — bundled Postgres + Redis (default)

```bash
cp .env.example .env          # COMPOSE_PROFILES=local-infra by default
docker compose up             # postgres+redis → migrate (once) → api + web
```

`api` waits for the `migrate` service to complete, then becomes healthy on
`/api/v1/health/ready`. `web` waits for `api` to be healthy.

### Managed / VPS DB, remote Redis, real S3

Edit `.env`:

```bash
COMPOSE_PROFILES=                       # empty → do NOT start bundled infra
COMPOSE_DATABASE_URL=postgresql://…?sslmode=require
COMPOSE_REDIS_URL=rediss://…
STORAGE_DRIVER=s3
STORAGE_BUCKET=…  STORAGE_ACCESS_KEY_ID=…  STORAGE_SECRET_ACCESS_KEY=…  # + region/endpoint
# MIGRATION_DATABASE_URL=…              # only if COMPOSE_DATABASE_URL points at a pooler
```

```bash
docker compose up             # bundled postgres/redis skipped; migrate runs against your DB
```

> **Common mistake:** leaving `COMPOSE_PROFILES=local-infra` while pointing
> `COMPOSE_DATABASE_URL` at a remote DB will _also_ start the bundled
> Postgres/Redis. Set `COMPOSE_PROFILES=` empty for remote mode.

### Upgrades (new migrations in a release)

The `migrate` service is one-shot; `docker compose up` does not re-run a container
that already exited successfully. Re-run it explicitly **before** recreating the app:

```bash
git pull
docker compose build
docker compose run --rm migrate          # apply new migrations once
docker compose up -d --no-deps api web   # recreate the app with the new image
```

### Validate the compose graph

Cheap sanity check for both modes (no containers started):

```bash
COMPOSE_PROFILES=local-infra docker compose config --quiet   # local
COMPOSE_PROFILES=          docker compose config --quiet     # remote
```

## Production rollout (without compose)

Run the **same production image** as a one-shot migration before rolling out the
app. Kubernetes — a Job, ideally a Helm `pre-upgrade` hook:

```yaml
# Job (same image as the Deployment), runs once before the app rollout
command: ['./node_modules/.bin/prisma', 'migrate', 'deploy']
env:
  - name: DATABASE_URL # direct URL; only DATABASE_URL is needed here
    valueFrom: { secretKeyRef: { name: amcore-db, key: direct-url } }
```

An init container is a simpler but caveated alternative (it runs per Pod and
relies on Prisma's advisory lock to serialize replicas, which can hang under
PgBouncer transaction pooling). Prefer "run once before rollout."

Manual one-off (any Docker host):

```bash
docker run --rm -e DATABASE_URL="postgresql://…?sslmode=require" \
  <amcore-api-image> ./node_modules/.bin/prisma migrate deploy
```

## Production environment requirements

The dev-friendly compose defaults are local-only. With `NODE_ENV=production` the
API fails fast (ADR-029 / env validation) unless:

- `DATABASE_URL` includes `sslmode=require` or `sslmode=verify-full`;
- `STORAGE_DRIVER=s3` with `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` /
  `STORAGE_SECRET_ACCESS_KEY` (+ region/endpoint for non-AWS providers);
- `JWT_SECRET` is a real secret ≥ 32 chars (`openssl rand -base64 32`).

## Adopting on an existing database

If the target DB already has the schema, baseline it once so Prisma records the
applied migrations instead of trying to re-create them:

```bash
prisma migrate resolve --applied <migration_name>   # repeat per already-applied migration
```

This is a one-time adoption step, not part of normal deploys.

## Rollback

Prisma has no automatic down-migration. Roll back by **restoring from backup** or
by shipping a **forward-fix** migration. Destructive migrations (dropping/renaming
columns) require app-compatibility planning — deploy a backward-compatible app
first, migrate, then remove the old path in a later release.

## Seeding

`pnpm --filter api db:seed` is dev/demo only. There is no implicit production
seed; production rollout runs `migrate deploy` and nothing else.

## Not covered here

Worker/process-role topology, Redis production HA, queue prefixes, and DB pool
sizing across web/worker replicas are **Arc 3** (API/worker split + Redis/BullMQ
production profile). Remote Redis here is just `REDIS_URL`.
