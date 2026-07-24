# Deployment & Migrations

How to take AMCore from clone → migrated schema → running app, locally and in
production.

## Branch, release & environments model

AMCore uses **GitHub Flow**: a single protected trunk `main`, short-lived PR
branches, **Squash** merges, and **releases as annotated `vX.Y.Z` tags / GitHub
Releases**. There is no long-lived `develop` branch.

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
always present. An optional automatic-HTTPS reverse proxy sits behind the
`edge` profile — see "TLS & reverse proxy" → "Optional bundled edge: Caddy"
below. The switch is `COMPOSE_PROFILES` in `.env`. The Docker stack reads
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

Run the **CLI-capable migrator image** as a one-shot migration before rolling out
the slim app image. Kubernetes — a Job, ideally a Helm `pre-upgrade` hook:

```yaml
# Job (migrator image built from the same source state), runs once before rollout
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
  <amcore-api-migrator-image>
```

## Telegram webhook registration (one-shot, optional)

If the Telegram notification channel is enabled (`TELEGRAM_BOT_TOKEN` +
`TELEGRAM_BOT_USERNAME` + `WEBHOOK_TELEGRAM_SECRET` set — see
[`webhooks.md`](webhooks.md)), register the webhook **once per deploy** (not at replica
startup) with the same production image — plain Node, no pnpm/tsx:

```bash
# Same image as the Deployment; needs TELEGRAM_BOT_TOKEN, WEBHOOK_TELEGRAM_SECRET,
# TELEGRAM_WEBHOOK_URL (the public URL of POST /webhooks/telegram). Optional:
# TELEGRAM_DROP_PENDING=true to drop the backlog. Prints no token/secret.
docker run --rm -e TELEGRAM_BOT_TOKEN=… -e WEBHOOK_TELEGRAM_SECRET=… \
  -e TELEGRAM_WEBHOOK_URL="https://api.example.com/webhooks/telegram" \
  <amcore-api-image> node dist/cli/telegram-setup.js
```

It calls `setWebhook` with the secret and `allowed_updates:['message']`. **Secret
rotation:** set a new `WEBHOOK_TELEGRAM_SECRET`, redeploy, then re-run this command.

## Production environment requirements

The dev-friendly compose defaults are local-only. With `NODE_ENV=production` the
API fails fast (env validation) unless:

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

## Process roles: web / worker

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

Multi-instance safety is already in place, and the two cron flavors are
deliberate. The nightly **cleanup** and **notification-retention** sweeps are
Redis-lock-guarded (only one replica runs each; a skipped run self-repairs the
next night). The **notification-dispatch recovery** cron is the exception: it runs
on **every** worker replica and is _not_ lock-guarded — that is intentional
(`SingletonCronRunner` is fail-closed on a Redis hiccup, exactly when recovery is
needed), and Postgres `FOR UPDATE SKIP LOCKED` is the coordinator, so replicas
drain disjoint rows without double-sending. The throttler is Redis-backed and
BullMQ workers consume one shared queue. Add worker replicas freely.

## TLS & reverse proxy

AMCore's Node process speaks plain HTTP; TLS terminates at the **edge** — a
reverse proxy, your cloud load balancer, or a Kubernetes Ingress — never inside
the app. There is no in-app certificate management. `helmet()` already sends
HSTS and the other secure-header defaults (`apps/api/src/main.ts`); once the
edge speaks HTTPS, the app side needs no extra configuration for that part.

The proxy is **bring-your-own** — nginx, Caddy, Traefik, an ALB/GCP HTTPS LB, or
an Ingress controller all work. This guide documents **nginx** as the
first-class example because it fronts the majority of compose/VPS deployments
of this starter; a cloud LB/Ingress applies the same two rules below through
its own listener/annotation configuration instead of an `nginx.conf`.

### The two rules any edge proxy must follow

1. **Terminate TLS, forward plain HTTP.** The proxy holds the certificate
   (Let's Encrypt/ACME, a managed cert, or your CA); it speaks HTTPS to the
   internet and HTTP to `api`/`web` on the private network.
2. **Sanitize `X-Forwarded-*` at the edge, and configure `TRUST_PROXY` to match
   whatever the edge actually does.** A caller can send its own
   `X-Forwarded-For`/`X-Forwarded-Proto` — if nginx is your edge, **overwrite**
   them (`proxy_set_header`, not `$proxy_add_x_forwarded_for`) so a spoofed
   client header never reaches the app. Some managed load balancers instead
   **append** to an existing `X-Forwarded-For` by documented default (e.g. AWS
   ALB) rather than overwrite it — that is not a misconfiguration, but it means
   safety comes from the app's side, not the header: pair either behavior with
   the app's opt-in **`TRUST_PROXY`** setting (`.env.example`, default
   `false`). The app never parses forwarded headers itself — `req.ip`/
   `req.protocol` reflect them **only** once `TRUST_PROXY` is configured for
   your exact proxy topology (e.g. `TRUST_PROXY=loopback` for an nginx on the
   same host, or the exact trusted hop count/CIDR for a managed LB), which
   makes Express trust only the last N untrusted hops rather than the whole
   `X-Forwarded-For` chain. Leaving `TRUST_PROXY=false` behind a proxy that
   already sanitizes headers is safe, but audit/request logs then record the
   proxy's own IP, not the client's. Avoid broad `TRUST_PROXY=true` unless the
   edge is guaranteed to sanitize (not append to) forwarded headers.

### Reference nginx config

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # nginx defaults this to 1m, which would 413 real uploads before AMCore's
    # own validation ever runs. 45m covers the largest current hard limit (the
    # 40 MiB AI artifact upload cap, apps/api/src/core/ai/artifacts/
    # ai-artifact.constants.ts) with headroom; raise it if you raise that
    # constant or any other upload ceiling further.
    client_max_body_size 45m;

    location / {
        proxy_pass http://api:5002;
        proxy_http_version 1.1;

        # Overwrite, don't append — replaces any client-supplied values.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Host $host;
    }

    # SSE endpoints (see "Realtime SSE behind a proxy" below) need buffering
    # off and a read timeout above the heartbeat interval.
    location ~ ^/(api/v1/notifications/stream|api/v1/ai/runs/.+/stream)$ {
        proxy_pass http://api:5002;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 75s;
    }
}
```

Then set `TRUST_PROXY=loopback` (nginx on the same host) or the appropriate
subnet/hop count, and see "Realtime SSE behind a proxy" below for the full
streaming-specific rules (buffering, timeouts, connection caps).

### Cloud load balancer / Ingress

A managed LB or Kubernetes Ingress (ALB, GCP HTTPS LB, Ingress-nginx, …)
terminates TLS the same way, but you configure header/timeout/body-size
behavior through the platform, not an `nginx.conf`. Check your provider's
documented `X-Forwarded-For` behavior rather than assuming it — **AWS ALB
appends by default** rather than overwriting, which is fine as long as
`TRUST_PROXY` is set to the exact trusted hop count/CIDR (so Express trusts
only the LB's own hop, not the whole header chain) rather than the broad
`true`. Also confirm idle/read timeouts exceed the SSE heartbeat and that the
platform's request body-size limit is at or above your largest enabled
upload ceiling.

### Optional bundled edge: Caddy

If you don't already run a reverse proxy, `docker-compose.yml` ships an
**optional** [Caddy](https://caddyserver.com/) service behind the `edge`
profile that gets you automatic HTTPS with almost no configuration. It is a
**replacement** for a reverse proxy, not an addition — don't run it alongside
nginx/Traefik/a cloud LB, and don't enable it if a platform LB/Ingress already
terminates TLS in front of this stack.

Enable it by adding `edge` to `COMPOSE_PROFILES` (e.g.
`COMPOSE_PROFILES=local-infra,edge`) and setting these in `.env`:

```bash
CADDY_DOMAIN="api.example.com"   # must have an A/AAAA record pointed at this host
CADDY_EMAIL="ops@example.com"    # ACME account contact (Let's Encrypt)
TRUST_PROXY=1                    # Caddy is exactly one hop in front of the app
```

`docker/caddy/Caddyfile` fronts `api:5002` by default — matching the nginx
example above, and consistent with `apps/web` being a deliberate starter
shell rather than a required production surface. A commented block in that
file shows how to also front `apps/web` on a second domain if you want to
expose it too.

A few things that differ from the nginx example on purpose:

- **No `client_max_body_size`-equivalent needed.** Caddy's `reverse_proxy`
  has no default request-body-size cap, unlike nginx's `1m` default.
- **No SSE tuning needed.** Caddy detects `Content-Type: text/event-stream`
  and streams the response immediately; there is no buffering flag to turn off.
- **`X-Forwarded-*` is sanitized by default.** Unlike nginx, Caddy's
  `reverse_proxy` ignores client-supplied `X-Forwarded-For`/`-Proto`/`-Host`
  values out of the box and sets them itself from the real connection — no
  extra directive required. Because Caddy is exactly one hop in front of
  `api`, set **`TRUST_PROXY=1`** (not a preset or CIDR) so the app trusts
  that one hop and no further.

**Honesty caveat:** this profile serves the **compose deployment path**
only. If you deploy to a managed platform or Kubernetes, TLS terminates at
the platform's LB/Ingress instead (see "Cloud load balancer / Ingress"
above) — don't add this Caddy service there. For local testing without a
public domain, `docker/caddy/Caddyfile` has a comment showing the
`localhost` + `tls internal` (Caddy's local CA) alternative to Let's Encrypt.

## Realtime SSE behind a proxy

Two long-lived SSE endpoints share the same rules and must not be buffered or timed
out by an intermediary: `GET /notifications/stream` and the AI run
**status-only** stream `GET /ai/runs/:id/stream` (the same primitives,
governed by the parallel `AI_REALTIME_*` knobs; e.g. `AI_REALTIME_HEARTBEAT_MS`,
`AI_REALTIME_MAX_CONNECTIONS`, `AI_REALTIME_NAMESPACE`). The guidance below is written
for the notification stream; apply it identically to the AI run stream.

- **Disable response buffering.** The app sends `X-Accel-Buffering: no` and
  `Cache-Control: no-cache, no-transform`; honor them. For NGINX, `proxy_buffering
off` on the stream location (and never gzip a `text/event-stream`).
- **Read timeout > heartbeat.** The server heartbeats every
  `NOTIFICATIONS_REALTIME_HEARTBEAT_MS` (default 20s); set the proxy read timeout
  comfortably above it (NGINX `proxy_read_timeout` default is 60s — fine for 20s).
- **Prefer HTTP/2 at the ingress.** HTTP/1.x browsers cap concurrent connections
  per origin (~6), which the per-tab streams would consume; HTTP/2 multiplexes them.
- **Rate-limit at the ingress, not the app.** The app enforces only a per-user cap
  (429) and a global per-process cap (503); real client-IP / cluster-wide limiting
  belongs at the trusted proxy. See "TLS & reverse proxy" above for the
  **`TRUST_PROXY`** setting that makes `req.ip`, rate limiting, and audit/logging
  reflect the real client behind your proxy.
- **No sticky sessions needed.** Any replica can serve any user — a hint published
  on one replica fans out via Redis Pub/Sub to all. **When several environments
  share one Redis, give each a distinct `NOTIFICATIONS_REALTIME_NAMESPACE`** so
  their channels do not collide.
- **Size the global connection cap to the process, not the cluster.**
  `NOTIFICATIONS_REALTIME_MAX_CONNECTIONS` defaults to **10000** per process — a
  **configurable safety ceiling, not a validated capacity target**. It bounds two
  independent budgets you must size for your instance: **file descriptors** (≈1 FD
  per stream, plus Node's libuv overhead) and **memory** (per-connection socket
  buffers plus the bounded write queue, `NOTIFICATIONS_REALTIME_QUEUE_DEPTH` × frame
  size). The hard floor is the **FD ulimit**: keep the cap below `RLIMIT_NOFILE`
  minus headroom for the DB/Redis pools and inbound HTTP. The memory cost per stream
  is **runtime- and workload-dependent — load-test and measure RSS at your target
  concurrency** rather than trusting a rule of thumb, especially on small (256–512 MB)
  containers, where 10000 streams will likely exhaust memory long before the FD
  limit; set the cap to the measured value with margin. The cap is per replica —
  scale total fan-out by adding replicas, not by raising this number past the
  measured per-instance budget.
- **Recovery is the client's refetch.** Delivery is at-most-once; a dropped hint
  (Redis blip, restart) is recovered when the client reconnects and refetches the
  feed — nothing is replayed server-side.

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
