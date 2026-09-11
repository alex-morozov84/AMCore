# Deployment Platforms

**Sources checked: 2026-09-06.** Every external claim below was verified
against the cited page on this date, not carried over from an earlier
research pass. Re-check before trusting a claim here past its next platform
doc update — that's the whole reason this page cites sources instead of
just asserting.

This is a **decision matrix, not a recipe collection**. [VPS + Docker
Compose](deployment.md#production-rollout-via-registry-image-pull-path) is
the only platform AMCore owns a full, tested recipe for — restart policies,
log rotation, health-gated rolling restarts, blue-green, backup/restore
rehearsal, all verified against the actual compose files in this repo. Every
platform below gets a **durable, officially-sourced, dated** mapping of how
AMCore's actual pieces land on that platform's primitives, and the concrete
caveats that follow from AMCore's shape — not a maintained deploy script.
Provider docs, pricing, and product names change faster than this file can
track; treat the cited pages as the source of truth and this guide as an
index into them, not a replacement.

## What AMCore actually needs

Every row below is evaluated against the same five requirements, because
AMCore is not a stateless static site:

1. **A persistent, long-running API process** (`PROCESS_ROLE=web`) — ordinary
   HTTP, but continuously running, not invoked per-request from cold.
2. **A separate, persistent worker process** (`PROCESS_ROLE=worker`) —
   BullMQ processors + cron, no inbound business traffic, only health and
   metrics HTTP (see [Process roles](deployment.md#process-roles-web--worker)).
   This is the piece that eliminates the most platforms outright: it needs a
   place to run a process with **no HTTP request driving it**, indefinitely.
3. **Redis**, doing three jobs at once: BullMQ's queue backend, the
   Redis-backed GCRA rate limiter, and the BFF's session vault
   ([`apps/web`'s Redis-backed session store](deployment.md#redis-production-profile)).
   A platform without a real, persistent Redis (or a compatible managed one)
   doesn't just lose caching — it loses queue durability and session state.
4. **Postgres**, with [production DB role
   separation](database-role-separation.md) as the recommended posture. That
   guide's own testing already confirms this works against **both** a true
   superuser admin connection **and** a `CREATEROLE`-holding non-superuser
   admin — the shape most managed Postgres providers actually hand you — so
   "our provider doesn't give us a superuser" is not a reason to skip it.
5. **Long-lived SSE connections** (`GET /api/v1/notifications/stream`,
   `GET /api/v1/ai/runs/:id/stream`) that must not be buffered or time out early —
   see [Realtime SSE behind a proxy](deployment.md#realtime-sse-behind-a-proxy).
   A platform whose request/response model doesn't support a slow, open,
   streamed HTTP response for minutes at a time breaks this feature
   specifically, even if everything else works.

## Quick matrix

| Platform         | Full recipe?                                 | Worker fits?                         | Redis                                    | Postgres                                             | Headline caveat                                                                              |
| ---------------- | -------------------------------------------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| VPS + Compose    | **Yes** — see [deployment.md](deployment.md) | Yes, natively                        | Bundled or external                      | Bundled or external, role separation applies as-is   | None beyond what's already documented                                                        |
| Kubernetes       | No — conceptual mapping only                 | Yes, second Deployment               | Managed or in-cluster                    | Managed or in-cluster, role separation applies as-is | No maintained Helm chart from this repo (deliberate)                                         |
| Google Cloud Run | No                                           | Yes, via Worker Pools                | Memorystore, needs VPC egress            | Cloud SQL, role separation applies as-is             | Worker Pools have no built-in autoscaling                                                    |
| Fly.io           | No                                           | Yes, as a service-less process group | Upstash (Fly-partnered), not first-party | Fly Managed Postgres, role separation applies as-is  | None specific to AMCore's shape once the worker has no `[http_service]`/`[[services]]` block |
| Render           | No                                           | Yes, first-class primitive           | Render Key Value (first-party)           | Render Postgres (first-party)                        | None specific to AMCore's shape                                                              |
| Railway          | No                                           | Yes, as a service                    | Railway-managed Redis                    | Railway-managed Postgres                             | Push toward managed DBs over Compose-style containers                                        |
| Vercel           | No — **web only**                            | **No**                               | Marketplace only, no first-party product | N/A (not where Postgres would run)                   | The API and worker cannot run here at all                                                    |

## VPS + Docker Compose

The owned recipe. See [Deployment &
migrations](deployment.md#production-rollout-via-registry-image-pull-path),
[Production deploy profile](production-deploy-profile.md), [Database role
separation](database-role-separation.md), [Backup &
restore](backup-restore.md), and [Secret rotation](secret-rotation.md) — this
page adds nothing to that path beyond context for comparing it to the rest of
this matrix.

## Kubernetes

**No maintained Helm chart ships from this repo — deliberately.** A chart is
a second deployment artifact to keep in sync with every future change to
`docker-compose.yml`, the env schema, and the migration contract, for a
target this starter does not own end-to-end. The conceptual mapping instead:

- `api` (`PROCESS_ROLE=web`) and `worker` (`PROCESS_ROLE=worker`) are **two
  separate `Deployment`s from the same image**, differing only in
  `PROCESS_ROLE` and replica count — this is the exact scaling model
  [Process roles](deployment.md#process-roles-web--worker) already documents
  for a multi-process setup, Kubernetes or not.
- The one-shot `prisma migrate deploy` step maps to a `Job` (or an
  `initContainer` on the `api` Deployment, if you want it to run before every
  rollout) using the CLI-capable migrator image, matching the
  [migration contract](deployment.md#migration-contract)'s "one-shot, not
  continuous" model exactly.
- `worker`'s `/api/v1/health/*` and `/api/v1/metrics` (its only exposed HTTP,
  per [Process roles](deployment.md#process-roles-web--worker)) are what a
  liveness/readiness probe and a Prometheus `ServiceMonitor`/scrape config
  should target — it has no business routes to probe instead.
- Redis and Postgres: either a managed service (Memorystore/Cloud SQL-style,
  or your cluster's cloud provider equivalent) or an in-cluster deployment
  (e.g. the Bitnami Redis/Postgres charts) — this repo takes no position on
  that choice, only on the app-side contract (`REDIS_URL`/`DATABASE_URL`).
  Role separation from [Database role
  separation](database-role-separation.md) applies unchanged.
- TLS/ingress: an `Ingress` resource or your cluster's Gateway API
  implementation replaces the reference nginx/Caddy config in
  [TLS & reverse proxy](deployment.md#tls--reverse-proxy) — the two rules
  that section states (buffering disabled for SSE, `X-Forwarded-*` wired to
  `TRUST_PROXY`) apply to whatever terminates TLS, Kubernetes or not.

**If you want to generate a starting chart from the existing Compose files**
rather than hand-writing one, two actively maintained tools do exactly that:
[Katenary](https://github.com/Katenary/katenary) reads a Compose file and
generates a configurable Helm chart directly; the official Kubernetes project
[Kompose](https://kompose.io/) (an incubator-graduated project under
`kubernetes/kompose`) converts Compose files to plain Kubernetes manifests.
Neither is maintained by or bundled with AMCore — verify the output against
this section's mapping (especially the worker's health-only HTTP surface and
the migration `Job` step) rather than trusting a generated chart as-is.

## Google Cloud Run

Cloud Run's ordinary services autoscale from zero and are billed per-request
— a good fit for `api`, a bad fit for `worker`, which has no request to scale
on. **Worker Pools** close that gap: a Cloud Run resource "specifically
designed for performing continuous background work," with no load-balanced
endpoint and no request-driven autoscaling — up to 10 containers per instance (main plus
sidecars), scaled manually or by external metrics you wire up yourself, not
by Cloud Run's own request-based autoscaler
([Cloud Run Worker Pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools)).
That "manual/external scaling only" property is the one thing to plan for:
`worker` here doesn't get Cloud Run's headline autoscaling story the way
`api` does.

Redis via Memorystore needs network reachability from Cloud Run, which Google
now recommends via **Direct VPC egress** over the older Serverless VPC Access
connector — lower latency, higher throughput, lower cost, no managed
connector instances to run
([Connecting Cloud Run to Memorystore](https://docs.cloud.google.com/memorystore/docs/redis/connect-redis-instance-cloud-run)).
Postgres via Cloud SQL, with [Database role
separation](database-role-separation.md) unaffected by Cloud SQL's own IAM
layer — that guide's admin-connection testing already covers a
`CREATEROLE`-holding non-superuser, the shape Cloud SQL's own admin user has.

## Fly.io

AMCore's worker maps onto Fly's own recommended pattern for exactly this
problem, not around a limitation. Fly's autostop/autostart mechanism is
proxy-mediated: it watches inbound connections on a Machine's service
definition — either the modern `[http_service]` block (what today's
`fly launch` generates) or the older `[[services]]` form; both assign the
Machine to the Fly Proxy the same way — and can stop a Machine it considers
idle. The documented gotcha is specifically about work spawned **from inside
an HTTP handler** on a Machine that has one of those blocks — the proxy sees
the request finish and may stop the Machine while background work is still
running inside it. A **separate process group with neither an
`[http_service]` nor a `[[services]]` block at all is invisible to that
logic — the proxy never manages its lifecycle**, which Fly's own guidance
names as the preferred fix ("Pattern B": split web and worker into separate
process groups, scale independently) rather than the fallback of disabling
autostop and handling `SIGTERM` drainage yourself ("Pattern A")
([Long-running tasks and machine lifecycle](https://fly.io/docs/blueprints/long-running-tasks/)).
AMCore's `worker` is already exactly that: a separate `PROCESS_ROLE` with no
business HTTP surface — map it to its own Fly process group with no service
block of either form and Pattern B applies with no extra work.

Postgres: Fly's first-party **Managed Postgres** (distinct from the older,
self-operated "Fly Postgres" app pattern —
[Managed Postgres](https://fly.io/docs/mpg/) vs.
[Fly Postgres (Unmanaged)](https://fly.io/docs/postgres/); read which one a
given Fly doc page is describing before following it). Redis: Fly has no
first-party managed Redis — it partners with **Upstash**, described in Fly's
own docs as "managed Redis living right next door to your Fly.io apps"
([Launching Redis by Upstash](https://fly.io/blog/launching-redis-by-upstash/)).

## Render

Render's service catalog maps onto AMCore's shape as first-class primitives,
not workarounds: **Web Services** for `api`, **Background Workers** for
`worker` (Render's own docs name **BullMQ** by name as a supported worker
framework — "simplify polling a task queue backed by a Redis-like store"),
**Postgres** and **Key Value** (Render's Redis-compatible managed store) as
first-party data services
([Service types](https://render.com/docs/service-types),
[Background workers](https://render.com/docs/background-workers)). A
background worker "runs continuously... but doesn't receive any incoming
network traffic" — the same shape as AMCore's `worker` role, health/metrics
HTTP aside. Role separation from [Database role
separation](database-role-separation.md) applies unchanged against Render
Postgres.

## Railway

Railway's own Compose-migration guidance maps each Compose service to one
Railway service 1:1 — "each service defined in your Compose file maps to a
separate Railway service within a project" — so `api` and `worker` translate
directly. The same guidance pushes toward Railway's **managed** Postgres and
Redis instead of the `image: postgres:18`/`image: redis:7-alpine` containers
this repo's `docker-compose.yml` defines directly, citing automatic backups,
connection pooling, and no manual volume configuration as the reason
([Docker Compose on Railway](https://docs.railway.com/guides/docker-compose)).
Treat the bundled Compose file's `postgres`/`redis` services as a **template
of required configuration** (env vars, extensions, persistence expectations)
to translate onto Railway's managed equivalents, not as containers to lift
as-is. Role separation applies unchanged once on Railway Postgres.

## Vercel — web only, and not the whole `apps/web` either

Vercel is the one entry in this matrix where the honest answer is **don't**,
for the API and worker specifically — not a caveat to work around, a hard
mismatch:

- **`api` and `worker` cannot run on Vercel at all.** Both need a
  continuously running process; Vercel Functions are invocation-scoped with a
  duration ceiling — 300s by default on every plan, up to 800s (Pro/
  Enterprise, generally available) or 1800s under an opt-in beta for
  supported runtimes, never unbounded
  ([Configuring function duration](https://vercel.com/docs/functions/configuring-functions/duration)).
  A BullMQ worker that polls a queue indefinitely has no analog here.
- **No first-party Redis.** Vercel KV was discontinued and existing stores
  were migrated to Upstash Redis in December 2024; new projects provision
  Redis only through third-party Marketplace integrations
  ([Redis on Vercel](https://vercel.com/docs/redis)). Usable for caching, but
  it's an external dependency you provision and pay for separately, not a
  platform primitive.
- **The BFF's SSE endpoints and Redis-backed session vault are built around a
  long-lived, stateful Node process** ([Realtime SSE behind a
  proxy](deployment.md#realtime-sse-behind-a-proxy),
  [Redis production profile](deployment.md#redis-production-profile)) — the
  opposite of Vercel's per-invocation Function model. A stream held open for
  the SSE heartbeat interval competes directly against the duration ceiling
  above.

If a fork specifically wants `apps/web`'s **pages** on Vercel while running
`api`/`worker`/Redis/Postgres elsewhere, that's architecturally possible (it's
just a Next.js frontend calling an external API at that point) but is a
different, smaller deployment than "run AMCore on Vercel" — evaluate it as
"deploy a Next.js frontend that calls a remote API," not as a row in this
matrix.

## See also

- [Deployment & migrations](deployment.md) — the owned VPS/Compose recipe
  every row above is compared against.
- [Production deploy profile](production-deploy-profile.md) — the
  build-once/promote-by-digest contract, platform-agnostic in principle but
  demonstrated against the registry + GitHub Environments path.
- [Database role separation](database-role-separation.md) — applies
  unchanged on every managed Postgres in this matrix, including
  non-superuser admin connections.
- [Secret rotation](secret-rotation.md) — provider-specific rotation
  mechanics (Google OAuth, AWS IAM, Redis ACL) referenced there apply
  regardless of which platform runs AMCore.
