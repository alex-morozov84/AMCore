# Deployment & Migrations

How to take AMCore from clone → migrated schema → running app, locally and in
production. The canonical decision is recorded internally as ADR-040.

## Branch, release & environments model

AMCore uses **GitHub Flow**: a single protected trunk `main`, short-lived PR
branches, **Squash** merges, and **releases as annotated `vX.Y.Z` tags / GitHub
Releases**. There is no long-lived `develop` branch (see ADR-048).

Environments are driven by the **deploy pipeline, not by branches** — a branch per
environment is an anti-pattern:

| Trigger                               | Environment                   |
| ------------------------------------- | ----------------------------- |
| PR opened                             | CI checks / ephemeral preview |
| merge to `main`                       | **staging**                   |
| push a `vX.Y.Z` tag / publish Release | **production**                |

This is the **reference pattern**: AMCore ships the branch/tag model and the CI
gates, but the actual staging/production **deploy** wiring (GitHub Environments,
hosting, secrets) is yours to add. Build the image **once** and promote the **same
immutable digest** from staging to production — never rebuild from the tag.

To use a previous version, check out its tag (`git checkout v1.2.0`) or fork from it;
to keep an old line alive with backports, branch `release/1.x` from its tag, only when
a backport is actually needed.

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

## Process roles: web / worker (ADR-041)

The same image runs as different roles via `PROCESS_ROLE`:

- **`web`** — HTTP API + enqueues jobs; no BullMQ processors, no cron.
- **`worker`** — BullMQ processors + cron; **health + metrics** HTTP (no
  business routes, no Bull Board), so k8s can probe and Prometheus can scrape it.
- **`all`** — both in one process (default; host `pnpm dev` / single-node).

The reference `docker-compose.yml` runs `api` (`PROCESS_ROLE=web`) and a separate
`worker` (`PROCESS_ROLE=worker`); an email enqueued by the API is processed by the
worker. Scale them independently — e.g. in Kubernetes, two Deployments from one
image differing only by `PROCESS_ROLE` (and replica count). The worker listens on
`API_PORT` for `/api/v1/health/*` and `/api/v1/metrics` only; point its
liveness/readiness probe to health and Prometheus scrape config to metrics.
For a single-process setup, set `PROCESS_ROLE=all` and run no separate worker.

Multi-instance safety is already in place: the nightly cron is Redis-lock-guarded
(only one replica runs it), the throttler is Redis-backed (ADR-039), and BullMQ
workers consume one shared queue. Add worker replicas freely.

## Redis production profile

- **`maxmemory-policy noeviction` is mandatory** for the queue Redis — the only
  policy that keeps BullMQ queues correct (BullMQ docs). The bundled compose Redis
  sets it; a managed/VPS Redis must be configured the same.
- Enable **AOF persistence** so queued jobs survive a restart.
- **Recommended:** a **separate Redis instance** for queues vs cache/throttler in
  larger deployments (different memory/eviction needs). The starter shares one
  instance — fine if it is `noeviction` + persistent. Keys are namespaced
  (`amcore` BullMQ prefix, `throttle:v1:*`, `auth:*`, `rate:*`).
- Managed Redis: use `rediss://` (TLS) with ACL user/password in `REDIS_URL` /
  `COMPOSE_REDIS_URL`.

## Database pool sizing

Each process opens its own pool (`DATABASE_POOL_MAX`, default 10). Total
connections ≈ **(web replicas + worker replicas) × DATABASE_POOL_MAX** — keep it
under Postgres `max_connections` (with headroom for migrations/admin). Workers are
usually less DB-bound than web; lower their `DATABASE_POOL_MAX` unless jobs are
DB-heavy. Each role sets a distinct pg `application_name` (`amcore-web` /
`amcore-worker` / `amcore-all`) so pool pressure is visible per role in
`pg_stat_activity`.

> **Producer outage note:** the API enqueues via `queue.add()` on the shared
> BullMQ connection. `maxRetriesPerRequest` is intentionally left unset (BullMQ's
> worker connection enforces `null` itself); producer-side fail-fast for a Redis
> outage is handled at the call site, not by crippling the shared connection.

## Not covered here

Redis Sentinel/Cluster, autoscaling policy, and sandboxed (CPU-isolated)
processors are out of scope for this starter — extend per your platform.
