# Deployment Platforms

Choose a hosting topology before configuring credentials or building images.
AMCore supplies a [single-host Compose procedure](single-host-compose.md).
Other platforms below are mappings to provider primitives, not verified AMCore
installation recipes. Check current provider documentation and the exact selected
service's networking, persistence, shutdown and migration capabilities.

## What AMCore actually needs

1. An HTTP API process (`PROCESS_ROLE=web`) and a separate continuous worker
   (`PROCESS_ROLE=worker`). Workers consume queues and run scheduled jobs without
   an incoming business request. See [Process roles](deployment.md#process-roles-web--worker).
2. Redis for queues, rate limits and the web BFF session vault. Require the
   [Redis production profile](deployment.md#redis-production-profile), including
   persistence and `noeviction`; a cache-only or REST-only product is insufficient.
3. PostgreSQL with a restricted runtime role and a separate migration credential.
   [Role separation](database-role-separation.md) supports tested non-superuser
   administration, but that does not certify every managed provider's permissions.
4. An edge and application path that support unbuffered SSE, suitable connection
   lifetimes, body limits and trusted headers. See
   [SSE](deployment.md#realtime-sse-behind-a-proxy) and
   [BFF visitor addresses](single-host-compose.md#visitor-ip-through-the-web-bff).
5. Durable file storage: shared persistent local files for API/worker, or an
   explicitly configured [S3-compatible service](../storage/providers.md).
   Ephemeral container disks cannot hold the only copy of uploads or GeoIP data.

## Migration endpoint prerequisite

The [migration image](migrator-image.md#process-and-database-lifecycle) needs a
direct PostgreSQL endpoint that accepts and applies
`client_connection_check_interval=50ms` through startup options. Run the image's
read-only endpoint preflight with the selected version, credential and TLS settings.
Unknown, denied, ignored or different effective settings block this migration path.
An ordinary connection or provider capability list does not replace this check.

Keep the image's Tini entrypoint. In Kubernetes, leave `command` unset and use
full CLI `args` for overrides. The setting alone gives no fixed network-blackhole
detection bound. Run one coordinated migration job before admitting app replicas;
do not move migrations into per-replica startup.

## Quick matrix

| Platform         | AMCore recipe                         | Worker mapping                                 | Data services and main check                                                       |
| ---------------- | ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| VPS + Compose    | [Single host](single-host-compose.md) | Separate worker container                      | Bundled or external; select TLS, roles, persistence and backups.                   |
| Kubernetes       | Conceptual only                       | Separate Deployment                            | Managed or in-cluster PostgreSQL/Redis; one pre-rollout migration Job.             |
| Google Cloud Run | Conceptual only                       | Worker Pool                                    | Cloud SQL and reachable Redis; check endpoint preflight and worker scaling.        |
| Fly.io           | Conceptual only                       | Separate process group without a proxy service | Managed PostgreSQL/external Redis; check persistence and shutdown.                 |
| Render           | Conceptual only                       | Background Worker                              | PostgreSQL and Key Value; check Redis policy and endpoint capabilities.            |
| Railway          | Conceptual only                       | Separate service                               | Configure PostgreSQL/Redis explicitly; translate Compose dependencies.             |
| Vercel           | No AMCore recipe                      | Daemon capability exists                       | External data services; validate the API, BFF, SSE and worker topology separately. |

Provider capabilities are not AMCore execution evidence. For every target,
verify the migration endpoint, runtime grants, Redis behavior, secret delivery,
health/readiness, ordered rollout and recovery before admitting traffic.

## VPS + Docker Compose

Start with [Single-host production](single-host-compose.md) for the bundled
TLS database and Caddy edge. Use the [registry rollout](deployment.md#production-rollout-via-registry-image-pull-path)
when pulling immutable digests. [Capacity](capacity.md) covers host sizing.
Compose readiness waits do not provide uninterrupted service or automatic
rollback. Follow the documented stops and recovery limits.

## Kubernetes

No maintained Helm chart ships with AMCore. Map the services explicitly:

- Run API and worker as separate Deployments from the same backend image.
  Set their process roles and replica counts independently.
- Run the CLI-capable migrator as one coordinated Job before app rollout.
  A per-Pod init container conflicts with the one-shot migration contract.
- Probe the worker's `/api/v1/health/*`; scrape `/api/v1/metrics` through private
  networking and configured authentication. It exposes no business API.
- Provision durable PostgreSQL, Redis and file storage. Check role permissions
  and the exact migration endpoint rather than assuming managed-service support.
- Configure Ingress/Gateway headers, SSE buffering/timeouts and body limits.
  Keep the web BFF's trusted visitor-header contract separate from API proxy trust.

Validate any generated manifests against these requirements. A converted Compose
file does not establish rollout or recovery safety.

## Google Cloud Run

Use an HTTP service for API traffic. Request-based scaling alone does not keep a
queue consumer running. [Worker Pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools)
provide continuous background processes without a load-balanced endpoint; their
instance count needs explicit manual or external scaling management.

Redis must be reachable from both backend roles and the web BFF. Google's
[Memorystore connection guide](https://docs.cloud.google.com/memorystore/docs/redis/connect-redis-instance-cloud-run)
describes Direct VPC egress. For Cloud SQL, check the selected endpoint's TLS,
role administration and migration startup options before choosing the topology.

## Fly.io

Use separate API and worker process groups. Fly's
[long-running task guidance](https://fly.io/docs/blueprints/long-running-tasks/)
distinguishes proxy-managed HTTP Machines from workers without an
`[http_service]` or `[[services]]` assignment. Do not let request-idle shutdown
interrupt the continuous worker. Plan its shutdown and scaling explicitly.

[Managed Postgres](https://fly.io/docs/mpg/) is different from self-operated
Postgres on Machines. Select a reachable Redis service that meets AMCore's
queue requirements. Check persistence, role permissions and the exact migration
endpoint; the platform mapping alone proves none of these.

## Render

Map API to a Web Service and worker to a
[Background Worker](https://render.com/docs/background-workers). Render documents
continuous workers, including BullMQ, without incoming network traffic.
The [service catalogue](https://render.com/docs/service-types) includes Postgres
and Key Value. Check their configuration, private connectivity and monitoring;
do not assume that the worker's private health endpoint is publicly routable.

## Railway

Translate each component into a separate service using Railway's
[Compose migration guidance](https://railway.com/guides/docker-compose).
Provision PostgreSQL and Redis with the required settings and persistence.
Compose `depends_on` does not become a Railway readiness or rollout barrier.
Implement the migration and worker-first admission order in the target pipeline.

<a id="vercel--web-only-and-not-the-whole-appsweb-either"></a>

## Vercel

AMCore has no validated Vercel installation recipe.
Vercel now documents [Daemons](https://vercel.com/docs/daemons) for continuous
container workers, including [BullMQ](https://vercel.com/docs/background-workers),
and a [Container Runtime](https://vercel.com/docs/functions/runtimes/container)
for request-driven Functions. These capabilities do not establish compatibility
with AMCore's current images or deployment contract.

Evaluate the HTTP API, continuous worker and Next.js BFF separately. The BFF
needs Redis-backed sessions, trusted origins and streaming support; moving only
pages does not deliver authenticated application behavior. Check function duration,
SSE interruption, private networking, process signals and platform limits.
Daemon beta storage is ephemeral and preview deployments are unsupported; keep
durable data outside those containers and qualify the actual production path.
Use an externally provisioned [Redis service](https://vercel.com/docs/redis) that
satisfies the queue and BFF contracts.

Until a target-specific adapter and its checks exist, use the Compose procedure
or treat a Vercel deployment as an independently verified product integration.

## See also

- [Deployment & migrations](deployment.md) — operating and recovery contracts.
- [Production deploy profile](production-deploy-profile.md) — digest promotion.
- [Database role separation](database-role-separation.md) — required grants and limitations.
- [Backup & restore](backup-restore.md) — database and file recovery.
- [Secret rotation](secret-rotation.md) — credential changes and recovery.
