# Deployment & Migrations

How to take AMCore from clone → migrated schema → running app, locally and in
production.

The [migration image guide](migrator-image.md) covers the independent Prisma CLI
image, its minimal package in the shared frozen lock, maintenance and security reports.

For product administration, deploy the same checked placement source in API/web
and its generated edge mapping. Configure exact canonical origins and the shared
confidential hop key; keep the standalone web server private. See
[placement and sessions](../product-admin/placement-and-sessions.md) for alias/host
configuration, cookies, callback registration and coordinated upgrade/rollback.
Native development defaults to web port3002; Compose publishes3000. Override both
`FRONTEND_URL` and `WEB_TRUSTED_ORIGINS` to the actual Compose browser origin.

The API Dockerfile refreshes `perl-base` from Debian security repositories in
build/migrator and runner targets. API build/runner use Bookworm; the independent
migrator uses Trixie. Remove a refresh only after that target's base includes the
fixes and its final image scan confirms them. The API builder updates the whole
npm distribution from a checksum-pinned archive; its remaining toolchain risk is
separate from the final migrator inventory. Existing deployed images need a rebuild
and rollout to receive the update.

For password-accounting upgrades, the [stopped-writer procedure](#password-limiter-upgrade-and-rollback)
overrides general rolling/blue-green examples below.

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
- In a production setup following [DB role
  separation](database-role-separation.md), `MIGRATION_DATABASE_URL` carries
  a second responsibility beyond bypassing a pooler: it's also how the
  one-shot migration step authenticates as the schema-owning migrator role,
  distinct from the runtime role `DATABASE_URL` uses.

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

For a complete production deployment on one server, follow
[Single-host production with Docker Compose](single-host-compose.md); size the host
with [Capacity](capacity.md).

### Local — bundled Postgres + Redis (default)

```bash
cp .env.example .env          # COMPOSE_PROFILES=local-infra by default
docker compose up             # postgres+redis → migrate (once) → api + web
```

`api` waits for the `migrate` service to complete, then becomes healthy on
`/api/v1/health/ready`. `web` waits for `api` to be healthy.

**`web` now also talks to Redis directly (ADR-068).** The BFF session vault
that authenticates browser requests lives in Redis, not just in `api` — so
`REDIS_URL` (or `COMPOSE_REDIS_URL` for the Docker stack) is required for
`web`'s authenticated flows, the same as it already is for `api`. If Redis is
unreachable, `web` fails closed on those flows (no session can be created or
verified) rather than falling back to an insecure path; unauthenticated pages
keep working.

### Bundled Postgres and Redis

The bundled services publish their ports on `127.0.0.1` only, like `api` and
`web`. Tools on the same host reach `localhost:5432` and `localhost:6379`; other
hosts cannot.

| Situation                           | Action                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local development                   | Keep the defaults.                                                                                                                                                             |
| A VPS with bundled services         | Keep the defaults and follow [Single-host production](single-host-compose.md): its TLS overlay closes the fixed `amcore`/`amcore` login to the network. Redis has no password. |
| A tool on another host must connect | Set `POSTGRES_PUBLISH_HOST` or `REDIS_PUBLISH_HOST` only behind your own firewall.                                                                                             |

Docker port publishing bypasses host firewalls such as `ufw`, and many cloud
firewalls allow all inbound traffic by default. A published `0.0.0.0` port is
therefore reachable from the internet. Verify with `ss -tlnp` on the host:
the bundled ports must show `127.0.0.1`.

### Managed / VPS DB and remote Redis, with S3

Edit `.env`:

```bash
COMPOSE_PROFILES=                       # empty → do NOT start bundled infra
COMPOSE_DATABASE_URL=postgresql://…?sslmode=require
COMPOSE_REDIS_URL=rediss://…
STORAGE_DRIVER=s3
STORAGE_BUCKET=…  STORAGE_ACCESS_KEY_ID=…  STORAGE_SECRET_ACCESS_KEY=…  # + region/endpoint
STORAGE_PUBLIC_BASE_URL=https://cdn.example.com   # root of the public bucket (see public files)
WEB_PUBLIC_FILES_ORIGIN=https://cdn.example.com   # same origin: lets the web app load avatars (CSP img-src)
# MIGRATION_DATABASE_URL=…              # only if COMPOSE_DATABASE_URL points at a pooler
```

```bash
docker compose up             # bundled postgres/redis skipped; migrate runs against your DB
```

> **Common mistake:** leaving `COMPOSE_PROFILES=local-infra` while pointing
> `COMPOSE_DATABASE_URL` at a remote DB will _also_ start the bundled
> Postgres/Redis. Set `COMPOSE_PROFILES=` empty for remote mode.

Compose supplies `STORAGE_DRIVER=local` when it is unset, even with
`NODE_ENV=production`. Select `STORAGE_DRIVER=s3` explicitly for this S3 example, and
publish the public location as described in [Public Files](../storage/public-files.md).
For production files on the same VPS instead, use the
[local storage setup](#production-local-files) below.

### Invitation signup and local browser configuration

`AUTH_PUBLIC_SIGNUP_ENABLED` is passed to both backend process roles. Set it to
`false` to close ordinary email/new-account OAuth signup while retaining valid
invitation signup and existing-account login. The API enforces the decision;
frontend visibility is a projection of that policy.

Invitation browser entry requires HTTPS by default. For local HTTP Compose only,
set both `WEB_TRUSTED_ORIGINS` and `WEB_INVITATION_LOCAL_HTTP_ORIGIN` to the exact
origin you actually open, such as `http://localhost:3000`. For bare Next development
use its port3002 instead. The local setting is empty on HTTPS deployments; it
cannot authorize public HTTP hosts. Both settings are forwarded to the web service.
See [cookie policy](../frontend/browser-security-and-csp.md#invitation-browser-proof)
and [invitation scenarios](../product-admin/invitations.md).

### Search-engine indexing

The web app is closed to search engines unless you open it: every response carries
`X-Robots-Tag: noindex, nofollow`. Open only the production deployment of a product with public
pages by setting these on its web service, and leave them unset everywhere else:

```bash
WEB_SEO_INDEXING=enabled
WEB_SITE_ORIGIN=https://shop.example.com     # also listed in WEB_TRUSTED_ORIGINS
```

Both are read at run time, so the image you promote from staging to production (the same
immutable digest) is closed on staging and open in production without a rebuild. With `enabled`,
`WEB_SITE_ORIGIN` must be a canonical `https` origin that is also in `WEB_TRUSTED_ORIGINS`, or the
web service stops at start-up. Only requests whose `Host` equals that origin's host are open;
aliases, preview hosts, raw IPs and the Console host stay closed. Make your reverse proxy pass the
public `Host` unchanged (the bundled Caddy profile does) and keep the API's `FRONTEND_URL` equal to
`WEB_SITE_ORIGIN`. How to make pages public and how to verify the result:
[Search-engine indexing](../frontend/seo.md).

### Upgrades (new migrations in a release)

Use the same project, environment file and `COMPOSE_FILE` overlays as the running
installation. Build the new images (or pull approved digests), then run the
[migrator endpoint preflight](migrator-image.md#endpoint-preflight) against the existing database.
Stop after any failed command. If this installation contains policy1 EMAIL work,
follow the [welcome-policy upgrade](../email/queued-upgrade.md) instead of the
routine sequence below. It keeps old writers stopped through inventory and conversion.
Otherwise, apply migrations before recreating application services:

```bash
git pull
docker compose build
docker compose run --rm --no-deps migrate
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 worker
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 api web
```

Each application step waits for health before the next step. `run --rm` uses a
separate one-off migrator container. Keep `--no-deps` on later commands so they
do not start the ordinary `migrate` service after the application starts.
The 180-second limit bounds health waiting, not image pulls, builds or migrations.
A timeout stops this procedure; inspect the service state and safe logs before retrying.
An interrupted migration has an unknown outcome until inspected; never retry it blindly.

Workers go first because the queued-job envelope is a strict contract: a worker that
does not know a newer key fails that job terminally. Rollback runs in the opposite
order and needs a drain; see
[Changing the job envelope](../backend/background-work.md#changing-the-job-envelope).

Invitation upgrades require draining old invitation writers before migration.
The earlier `20261003180000_invitation_role_intent` repair is followed by
`20261004190000_invitation_intent_and_settlement`, which introduces complete role
intent, generations and durable recovery. Restart only the matching application;
[the invitation upgrade guide](../auth/invites.md#upgrade-an-existing-installation)
explains legacy rows, removed routes and compatible rollback. Use a maintenance
window rather than overlapping old/new invitation writers.

#### Notification and AI extension-contract upgrade

`20261008160000_notification_ai_extension_contracts` requires the same complete
maintenance stop below: back up and verify recovery, stop every old API role and
its restart policy, verify no old connections, deploy migrations once, then start
only the new version. It rejects connected `amcore-web`, `amcore-worker` and
`amcore-all` processes before changing rows. Other connection names are not a
fence; operators must stop those writers too. A failed guard transaction rolls
back; use the reported migration name with `prisma migrate resolve --rolled-back`
only after the old writers are stopped. Rollback requires the verified backup.

The upgrade does not reconstruct a request or approval from today's definitions:

| Existing evidence                                                                                                  | Upgrade result                                                           | Evidence retained                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| External `PENDING`, attempt count zero, no attempt rows, lease, receipt, delivery/failure timestamp or retry floor | Mark request contract version 1; first claim may prepare                 | Original target and notification version                                        |
| Any other active external `PENDING`, `PROCESSING` or `RETRY_SCHEDULED`                                             | `FAILED`, `legacy_request_unavailable`; open attempts become `ABANDONED` | Attempt count/history, target, provider receipt and retry floor; leases cleared |
| Terminal notification delivery or in-app delivery                                                                  | Unchanged                                                                | Historical outcome and all prior evidence                                       |
| Non-read-only `EXECUTING`, or active action with `startedAt` or `executionEpoch`                                   | `OUTCOME_UNKNOWN`; active run fails `tool_effect_unknown`                | Action identity and execution evidence; no automatic retry                      |
| `SUCCEEDED` action without `appliedAt`                                                                             | Active run fails `tool_state_inconsistent`                               | Successful action remains; no invented result or transcript                     |
| Other hashless active action, including read-only execution                                                        | `FAILED`, `tool_schema_incompatible`; active run fails                   | Legacy arguments and history; no compatibility inferred                         |
| Hashless pending approval                                                                                          | `EXPIRED`, with mandatory system audit event                             | Original gate and reason                                                        |
| Previous human approval/rejection or terminal history                                                              | Unchanged                                                                | Human decision and historical result                                            |

Unknown effects take precedence over compatibility failures. Open run attempts for
converted failed runs close as `EFFECT_UNKNOWN` or `FAILED` with the run's reason.
A reaped `PENDING` delivery remains attempted if an attempt row exists, even when
its current count is zero. Before restarting, inspect converted reason counts and
retained provider/effect evidence. Reconcile uncertain effects with the provider or
domain operator; never reset counters, erase receipts or automatically create a
fresh action to bypass refusal. Publish a new domain event only after reconciliation.
The executable upgrade matrix is
`apps/api/test/notification-ai-legacy-migration.e2e-spec.ts`.

#### AI run engine upgrade (maintenance stop)

The `20261015120000_ai_run_control` migration adds the database claim gate,
linked input identity and narrow cleanup tombstone. Stop every old `web`,
`worker` and `all` API process and disable auto-restart before applying it.
Old workers do not read the gate. The migration checks known AMCore connection
names, but operators must also stop clients that use another connection name.
Deploy every new role before allowing writers to restart. Verify the singleton
`ai.ai_run_control` row exists and inspect its `paused` value. A missing row
fails new claims closed. A paused row remains paused across restart; do not
reset it during deployment. Recovery can still expire deadlines and approvals
while paused. Resume through the audited background-work command API after checking
the new worker fleet. Rollback requires restoring the pre-migration backup;
mixed old and new writers cannot uphold the pause guarantee.

The migration does not backfill `inputMessageId` or assistant binding on older
runs. Their queued execution keeps the old input lookup, while manual retry
refuses them. New runs require the direct link and never fall back after it is
lost. The backend gate, control API and worker remain installed when the
optional Console frontend is disabled.

The migrations `20261005120000_ai_run_ownership_and_effect_identity`,
`20261005120100_ai_run_legacy_state_conversion` and
`20261007180000_ai_gateway_consistency` change what an AI run's retry
counter, lease and tool records mean, and convert existing rows. The execution-contract upgrade adds durable retry restrictions and strict
version-1 model identity; it does not rewrite old snapshots. Unversioned nonterminal
runs fail before tool/provider I/O with `model_snapshot_legacy_unsupported`; malformed
versioned snapshots fail with `model_snapshot_invalid`. Historical terminal rows are
unchanged. These migrations must not
overlap an old process that can still write AI state — that is **every** `web`,
`worker` and `all`-role process, not only workers (the HTTP handlers also create
runs, cancel them and decide approvals). Use a short maintenance stop; there is no
rolling mix and no down migration (roll back by restoring the pre-migration
backup, see [Backup & restore](./backup-restore.md)).

1. Take and verify a pre-migration database backup, then stop **all** old API processes of every role and keep them (and any
   auto-restart policy) stopped for the whole migration. A stopped worker's lease
   expiring does not prove a remote tool effect stopped: such effects stay
   uncertain (below).
2. Verify nothing old is connected:
   `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name IN ('amcore-web', 'amcore-worker', 'amcore-all');`
   must return `0`.
3. Run `docker compose run --rm migrate`. These migrations repeat that check
   themselves and **fail before changing anything** if a process named
   `amcore-web`, `amcore-worker` or `amcore-all` is still connected — on **every**
   database, including a fresh install with empty AI tables (an empty table does
   not prove an old process cannot write to it later). The check is a tripwire on
   the connection name, not a permanent fence: it cannot see a client with another
   name, so keep every old process and auto-restart stopped until the new version
   starts. In local development, stop `pnpm dev` / the local API before
   `pnpm --filter api db:migrate` for the same reason. If a migration
   fails, read its name from Prisma's failure output. Stop the writer, then mark
   that failed migration rolled back with
   `docker compose run --rm migrate ./node_modules/.bin/prisma migrate resolve --rolled-back <failed-migration-name>`.
   The name is `20261005120000_ai_run_ownership_and_effect_identity` or
   `20261005120100_ai_run_legacy_state_conversion` or
   `20261007180000_ai_gateway_consistency`; use the reported failed name,
   because the preceding migration may already have succeeded. Then run
   `docker compose run --rm migrate` again (until the failure is resolved, Prisma
   refuses further deploys with `P3009`). Test harnesses migrate a fresh database
   **before** starting the application for exactly this reason.
4. Start **only** the new version, `web` and `worker`/`all` together.

What the conversion does to existing data: a run's retry counter is converted to
"consumed retries" (queued runs keep it; running and waiting runs drop their
current claim); tool results and rejections that were already applied are marked
applied; an interrupted side-effecting tool call (`EXECUTING`) on any run, and an
ambiguous failure on an open run, become **outcome unknown** — a run holding one
fails `tool_effect_unknown` instead of asking the model again, and no history
is invented for attempts that happened before the upgrade. Terminal runs keep
their status and evidence.

### Validate the compose graph

Cheap sanity check for both modes (no containers started):

```bash
COMPOSE_PROFILES=local-infra docker compose config --quiet   # local
COMPOSE_PROFILES=          docker compose config --quiet     # remote
```

## Open tabs after a web deployment

The production frontend checks `/api/deployment-version` on mount, roughly every
30 seconds, and when focus or visibility returns. When the live build differs,
it replaces the entire document once. This stops timers from the previous page,
including custom downstream Server Action polling. Unsaved drafts can be lost.
A request sent before detection can fail; mutations are never automatically replayed.
A mutation already in flight may commit even if navigation interrupts its response;
do not treat that interruption as proof that resubmission is safe.
A downstream timer needs no special wrapper to benefit from document replacement.

This supports replacing one live web version, including rollback. It does not
keep old web containers or make an obsolete Action succeed against a new build.
Tabs loaded before this protection shipped require an initial manual refresh.
Malformed external `next-action` requests are outside this recovery mechanism.

### Build dependency lock

The API and web Docker build stages enforce a frozen pnpm lockfile for both the
explicit dependency installation and any automatic installation before a script.
pnpm can recheck dependencies after source files are copied into a cached
install layer. That recheck must preserve the checked-in dependency versions;
manifest/lockfile disagreement fails the build instead of resolving new versions.
Dependency changes require updating and reviewing `pnpm-lock.yaml` first.

### Build identity

`next build` generates a UUID unless `NEXT_DEPLOYMENT_ID` is supplied at build
time. The identity is compiled into the server and client and used for Next's
`deploymentId`. Runtime environment changes cannot change an image's identity.
Replicas, promotion and rollback use the same image digest and therefore the
same identity. Rebuilds generate a new identity; a cached identical artifact
retains its existing one. If setting an explicit identity, use a new value for
every different artifact (1–128 ASCII letters, digits, dots, underscores or
hyphens). Reusing an identity hides a deployment from old tabs.

For the Compose local-build path, `.env` can supply `NEXT_DEPLOYMENT_ID`; for a
custom Docker build, use `--build-arg NEXT_DEPLOYMENT_ID=<unique-build-id>`.
Leaving it unset is supported. Do not put secrets in this public identity.
Promotion must pull the original digest rather than rebuilding for production.

The API build automatically records its root product version, compiled
JS/shared-code/lockfile fingerprint and source commit when available. CI supplies
the checkout SHA automatically; local dirty builds omit a misleading exact commit.
These facts do not attest production or replace the deployed image digest.

The optional [Console Overview](../operations-console/overview.md) shows this API
identity and the compiled ID supplied by the responding web server. That web ID
does not necessarily identify JavaScript already loaded in a tab. See
[Console metadata settings](../operations-console/configuration.md#overview-metadata-and-resource-settings).

### Freshness and recovery limits

Allow unauthenticated GET access to `/api/deployment-version` on every frontend
host, including a separate Console host. It uses no session, database or Redis.
Keep its `Cache-Control`, `CDN-Cache-Control` and `Surrogate-Control: no-store`
headers; bypass CDN/proxy caching for this route. Full document requests must
also reach the current build. Next's `?dpl=` asset suffix busts caches; it does
not route to old builds or retain removed chunks. Mixed A/B replicas need an
independently designed routing strategy and are outside this single-version flow.

Each running tab makes at most one check at a time, with a five-second timeout.
Offline, unavailable, invalid or stale signals do not trigger rapid retries.
The tab tries again on its next ordinary check or focus return. A frozen tab
cannot check until it resumes; browser scheduling prevents a strict wall-clock
30-second guarantee. A signal that remains unavailable or stale cannot reveal
a deployment, so stale timers may continue until freshness is restored.
Downstream code that blocks document navigation or starves the JavaScript event
loop can prevent recovery.

The session guard permits at most three automatic replacements in five minutes
and stops further attempts if replacement still loads the old document. Manual
browser refresh recovers after the serving/cache problem is fixed. If browser
session storage is blocked, automatic replacement is disabled to avoid loops.

The bundled service worker caches only the two public install icons. Documents,
RSC, API/version requests, Next assets and failed responses have no worker cache
fallback. Offline navigation fails instead of loading an old application from
worker storage. A custom downstream worker must preserve this freshness contract.

See [production A/B verification](../frontend/testing.md#production-deployment-version-recovery)
for the custom Action timer regression scenario.

## Production rollout via registry (image-pull path)

`docker/compose/prod.yml` is a production overlay for the reference stack
above: it replaces each service's local `build:` with an `image:` pinned to
an immutable digest a registry + digest promotion pipeline already published
(see [Production deploy profile](production-deploy-profile.md)), adds an
explicit restart policy to every long-running service, and bounds/rotates
container logs. It changes nothing else — ports, volumes, environment, and
profiles all stay exactly as defined in the base file.

Set the three image references in the installation's private environment file:

```bash
COMPOSE_API_IMAGE="ghcr.io/<org>/<repo>/api@sha256:<64-hex-digest>"
COMPOSE_API_MIGRATOR_IMAGE="ghcr.io/<org>/<repo>/api-migrator@sha256:<64-hex-digest>"
COMPOSE_WEB_IMAGE="ghcr.io/<org>/<repo>/web@sha256:<64-hex-digest>"
```

The placeholders require real registry digests. Before pulling, check all three
references: each must name a repository and `@sha256:` followed by 64 hexadecimal
characters. **This is an operator check:** Compose accepts any nonempty reference,
including a mutable tag. Log in to a private registry using its approved credentials.

Keep the installation's project name, environment file and complete overlay list.
In `COMPOSE_FILE`, replace `docker/compose/supervise.yml` with `docker/compose/prod.yml`,
or add `prod.yml` directly after `docker-compose.yml` when supervision is absent.
Retain TLS, the private native-CLI URL override, web routing and relay overlays; see the
[single-host registry selection](single-host-compose.md#images-from-a-registry).
Explicit `-f` options replace `COMPOSE_FILE`, so a shortened command can drop them.

### First registry startup

Follow the [single-host setup](single-host-compose.md) through database roles and
certificates. Pull before any migration or application start:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --no-build --wait --wait-timeout 180 postgres redis
```

The last line is only for the bundled `local-infra` profile. With managed services,
skip it and verify the admitted database/Redis endpoints instead. Run the
[migrator endpoint preflight](migrator-image.md#endpoint-preflight) with the promoted
migrator image and exact migration credential. Then:

```bash
docker compose run --rm --no-deps migrate
```

For a new database, apply runtime grants and guarded system seed as described in
[single-host setup step 6](single-host-compose.md#6-migrate-grant-and-seed).
Pull `system-seed` with `--profile seed` first if using that profile. Then start
services in this order, stopping after any failure:

```bash
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 worker
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 api web
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 caddy
```

The last line applies only when the bundled `edge` profile is selected. API/web
are already healthy; `--no-deps` prevents another migration through Caddy's
API dependency. Caddy has no healthcheck: its `--wait` proves running, not HTTPS.
Complete the [HTTP readiness verification](#web-container-readiness) below.

### Registry upgrades

Check the [upgrade prerequisites](#upgrades-new-migrations-in-a-release), including
existing EMAIL work, before using this routine sequence. With healthy infrastructure,
set the new digests, preserve all overlays and run the endpoint preflight after pulling:

```bash
docker compose config --quiet
docker compose pull
# Run the promoted migrator's endpoint preflight before the next command.
docker compose run --rm --no-deps migrate
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 worker
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 api web
```

Worker readiness precedes the new API producer. Keep the existing Caddy running;
apply a changed proxy configuration deliberately and repeat the HTTPS checks.
The 180-second limit applies to health waiting, not the complete rollout.
A failed pull, missing credential or missing digest stops the procedure before
migration or replacement; do not fall back to a local build. Failed health waiting
requires inspection before another step. Migration failure uses the
[rollback inspection](#rollback), not an automatic downgrade.

### Verify the deployed artifact

Record the source revision, platform and three registry digests. API and worker
use the same API image. A multi-platform index digest, platform manifest digest
and local image ID identify different objects; do not compare their strings as
equal. Inspect only selected fields, because full container inspection exposes secrets.

Obtain only the nonsecret image references from the selected installation. Compose
reads its environment file; your shell does not. Run this in Bash with Python 3
available. Keep the same Compose selection used for the rollout:

```bash
set -o pipefail
image_refs=$(docker compose config --format json | python3 -c '
import json, re, sys
services = json.load(sys.stdin)["services"]
refs = [services[name]["image"] for name in ("api", "web", "migrate")]
if any(not re.fullmatch(r"[^\s]+@sha256:[0-9a-fA-F]{64}", ref) for ref in refs):
    sys.exit("Expected three immutable image references")
if services["worker"]["image"] != refs[0]:
    sys.exit("API and worker must use the same image")
print(" ".join(refs))
') || exit 1
read -r resolved_api_image resolved_web_image resolved_migrator_image <<< "$image_refs"
```

These shell variables contain references only. Do not source the private environment
file or print the full resolved configuration. Inspect the selected API image:

```bash
docker buildx imagetools inspect "$resolved_api_image"
docker image inspect --format '{{.Id}} {{json .RepoDigests}} {{.Os}}/{{.Architecture}}' "$resolved_api_image"
docker inspect --format '{{.Config.Image}} {{.Image}}' "$(docker compose ps -q api)"
docker inspect --format '{{.Config.Image}} {{.Image}}' "$(docker compose ps -q worker)"
```

Match the requested registry reference to the pulled `RepoDigests` and match each
container's `Image` to the pulled image's `Id`. Repeat for web and migrator; retain
the one-shot migrator's image/exit result before removal if collecting evidence.
Use `$resolved_web_image` and `$resolved_migrator_image` for their image inspections.
For the web image, compare `/api/deployment-version` with its baked deployment
version (`deploymentId` / `NEXT_PUBLIC_DEPLOYMENT_VERSION` in the standalone
configuration). Record the build-time `NEXT_DEPLOYMENT_ID` with the image digest.
This is separate from Next.js's `.next/BUILD_ID`, which can be constant when a
deployment ID is set. The deployment version alone is not image attestation.

When collecting migrator evidence, replace the usual `run --rm` step with this
sequence, using an unused task-specific container name. Do not run both variants:

```bash
docker compose run --name amcore-migration-proof --no-deps migrate || exit 1
docker inspect --format '{{.Config.Image}} {{.Image}} {{.State.ExitCode}}' amcore-migration-proof || exit 1
docker rm amcore-migration-proof
```

Require migration success and exit code zero before application startup. On failure,
retain the container for inspection instead of removing or repeating it blindly.

Prove pull/run on an isolated target
without cached application images or build sources before calling a deployment
path tested; `compose config` alone proves neither registry access nor runtime.

Every `*_IMAGE` var is **required** by the overlay (no default) — leaving one
unset fails `pull`/`up` immediately with a clear message rather than
silently reusing a locally built dev image in production. Log driver/size
(`COMPOSE_LOG_DRIVER`/`COMPOSE_LOG_MAX_SIZE`/`COMPOSE_LOG_MAX_FILE`,
`.env.example`) default to `local`, 20 MB × 5 files per container — Docker's
own docs recommend `local` over the unbounded-by-default `json-file` for its
automatic rotation, and `json-file` stays Docker's own default only for
backward compatibility and Kubernetes-runtime scenarios. `local`'s own
caveat: its files are for the Docker daemon and `docker logs`/`docker
compose logs` only, not for an external log-shipping tool to read directly
— use `json-file` instead if you need that, or apply the opt-in
[log-search overlay](log-search.md), which does it for `api`, `worker` and `web` and adds searchable
storage. `COMPOSE_LOG_DRIVER` only
accepts `local` or `json-file`; another driver uses different log-opt names
and fails at container **start**, not at `compose config` time. Requires a
Compose CLI supporting the `!reset` merge tag — available since Compose CLI
v2.17.3, below this repo's documented v2.20.2+ minimum, and already relied
on by this repo's own CI (`.github/compose.boot-smoke.override.yml`).

### Web container readiness

The web healthcheck requests `http://127.0.0.1:3000/api/deployment-version` inside
the container. Success requires HTTP 200 and a valid build-version JSON response;
redirects, missing routes and malformed responses fail. The probe uses no session,
page rendering or backend request. It proves local Next HTTP availability, not
successful login or availability of the API, database, Redis or email provider.

Node limits the request and body to three seconds. Docker's five-second timeout
also bounds a blocked Node event loop. Probes run every ten seconds with three
failures required for unhealthy status and a thirty-second startup grace period.
The product-web overlays wait for healthy web before initially starting Caddy;
the default API-only edge has no dependency on web. These dependencies do not stop
an already running proxy from forwarding to a later unhealthy service, and Docker
does not restart a container merely because it reports unhealthy.

After startup or replacement, verify both the actual HTTPS host and login page.
For the version request, require HTTP 200 and valid JSON. Compare its `version`
with the build-time `NEXT_DEPLOYMENT_ID` recorded by the image publisher (or their
recorded generated deployment version when that argument was omitted), not
`.next/BUILD_ID`. Obtain that value before declaring artifact verification complete:

```bash
curl --fail --silent --show-error --max-time 10 --write-out '\nHTTP %{http_code}\n' https://app.example.com/api/deployment-version
```

The command does not follow redirects. A 3xx, 404, 502, invalid JSON or unexpected
deployment version fails verification even if the command exits zero. Allow up to 180 seconds
for first HTTPS/certificate setup, checking at most every five seconds. If it still
fails, inspect the owned service and TLS logs; do not continue rollout. Do not log
credentials or query-token URLs. A local healthy signal does not replace this check.
Plain Compose replacement can return 502 until the new service is ready.

### Zero/low-downtime rollout — stated honestly

Plain `docker compose up -d`, with or without the overlay above, is **not**
zero-downtime: Compose stops the old container and starts the new one, so
there is a real gap during which `api`/`web` refuse connections. Two
escalation paths, in order of how much they cost to run:

1. **Health-gated rolling restart (routine deploys).** Put `api`/`web`
   behind a reverse proxy rather than relying on `api`'s published port
   directly, then cut traffic over only after the new container's own
   readiness healthcheck passes.

   - **The two proxy options this repo documents are not interchangeable for
     this specific pattern.** The shipped nginx config (above, `proxy_pass
http://api:5002`) resolves that hostname once, at nginx startup/reload,
     and caches the IP for the worker process's lifetime — recreating the
     `api` container mid-rollout gives it a new IP nginx doesn't know about,
     so nginx keeps sending traffic to the dead container until it's
     reloaded (`nginx -s reload`, or the container is restarted). Add
     `resolver 127.0.0.11 valid=10s;` and put the upstream in a variable
     (`set $upstream_api http://api:5002; proxy_pass $upstream_api;`) if you
     want nginx to actually resolve per this pattern. The optional Caddy
     `edge` profile does not have this problem: Caddy uses Go's default
     per-connection DNS resolution rather than resolving once at startup, so
     a new connection after the old container is gone naturally re-resolves
     to the new one via Docker's embedded DNS — no reload needed (documented
     Caddy community consensus, not a guarantee in Caddy's own reference
     docs; see [Caddy Community — proxy DNS resolver
     mechanism](https://caddy.community/t/proxy-dns-resolver-mechanism/5934)).
   - **The community tool [`docker-rollout`](https://github.com/wowu/docker-rollout)**
     implements this pattern for plain Compose (scale to two replicas, wait
     for the new one's healthcheck, remove the old one) — but it does **not**
     work against this repo's services as shipped: `docker-rollout`'s own
     README requires a service to have neither `ports:` nor `container_name:`,
     since it scales to two replicas and a fixed host port mapping can't be
     held by both at once. `api` (`127.0.0.1:5002:5002`) and `web`
     (`3000:3000`) both publish one. Using it requires your own overlay that
     resets those (`ports: !reset []`) and reaches the service only through
     your reverse proxy on the Compose network (`api:5002`/`web:3000`) — the
     network-name access the bundled Caddy `edge` profile already gives you
     for free, and that the nginx config needs the resolver fix above to do
     safely under this pattern. Not bundled or required by this starter;
     evaluate it once you've made that change, not before.

2. **Blue-green (releases that also carry a migration).** Run a second full
   Compose project (`-p amcore-green` against the new images), apply the
   migration against it, verify it, then flip your reverse proxy's upstream
   from the "blue" project to "green." This is the escalation path
   specifically because a same-stack rolling restart does not address
   migration ordering for a schema-changing release the way a fully separate
   stack does — "blue" stays untouched and is your instant rollback target.

   With `STORAGE_DRIVER=local`, the default `local_storage` volume is scoped to
   each Compose project. A new green project therefore starts with a different,
   empty file volume. Do not switch traffic until both deployments use a planned
   shared durable store or files have been copied and writes coordinated. S3
   avoids this project-volume split.

Neither path is bundled as a script in this starter; both are documented
patterns to apply with your own reverse proxy, since the correct choice
depends on infrastructure this repo does not own (see [Production deploy
profile](production-deploy-profile.md) → "Who this is for").

## Production rollout (without compose)

Run the **CLI-capable migrator image** as a one-shot migration before rolling out
the slim app image. Kubernetes — a Job, ideally a Helm `pre-upgrade` hook:

```yaml
# Job (migrator image built from the same source state), runs once before rollout
# Keep the image ENTRYPOINT and CMD: Tini must remain the init process.
# For status/resolve, override args with the complete local CLI command instead.
env:
  - name: DATABASE_URL # direct URL; only DATABASE_URL is needed here
    valueFrom: { secretKeyRef: { name: amcore-db, key: direct-url } }
```

The migrator's connection options and direct database capability requirements
also apply to Jobs. See [migration image lifecycle](migrator-image.md#process-and-database-lifecycle).
Do not replace the image entrypoint with Kubernetes `command` or a shell wrapper.

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

The dev-friendly Compose defaults are not a production configuration. With
`NODE_ENV=production`, API environment validation requires:

- `DATABASE_URL` includes `sslmode=require` or `sslmode=verify-full`;
- S3 credentials when the selected driver is `s3`, and `STORAGE_PUBLIC_BASE_URL` for `s3` and for `local`;
- `JWT_SECRET` is a real secret ≥ 32 chars (`openssl rand -base64 32`).

Choose `STORAGE_DRIVER` explicitly for production. Without Compose, an unset
driver resolves to S3. Compose supplies `local` by default, including in
production; API validation does not enforce a durable mount for that choice.
Use the persistent local setup below or configure S3.

### Production local files

File monitoring defaults to **one check every 10 minutes per API/worker instance**.
`STORAGE_PROBE_INTERVAL_SECONDS` supplies the deployment baseline (600 by default,
30–3600 seconds); Compose passes it to both roles. Processes validate it during
initialization, so changing `.env` requires redeployment. A saved runtime override
wins over that baseline and survives restart: after saving 60 seconds, changing
the baseline from 600 to 120 seconds still leaves the effective interval at 60.
The retained
[operator API](../backend/settings.md#operator-api-and-rights) can also reset the
override to each process's baseline.

<!-- AMCORE_CONSOLE_STORAGE_SETTING_START -->

A personal `SUPER_ADMIN` can change the inline interval on Console Overview and
**Save** without restart. The Console has no reset button.
<!-- AMCORE_CONSOLE_STORAGE_SETTING_END -->

S3 checks incur PUT/GET/DELETE traffic independently of user requests. Plan the
operation budget and detection delay using the
[storage monitoring guide](../storage/configuration.md#active-file-monitoring-and-readiness).

Local storage is a supported production choice. Compose shares `local_storage`
between API and worker at `/app/uploads`; a new volume inherits runtime uid 1001
ownership from the image. Provision existing/bind-mounted permissions explicitly.
Set the following values in `.env` when using the reference Compose stack:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/app/uploads
STORAGE_PUBLIC_BASE_URL=https://api.example.com/api/v1/storage/public
WEB_PUBLIC_FILES_ORIGIN=https://api.example.com
```

Use your actual public API origin; `WEB_PUBLIC_FILES_ORIGIN` must be the origin of
`STORAGE_PUBLIC_BASE_URL`, otherwise the web app cannot show avatars. If changing `STORAGE_LOCAL_ROOT`, change both
services' mounts as well. Keep the volume during upgrades, back up and restore
objects/meta/public together, and
verify files after container recreation. A successful live probe alone does not
establish persistence. Multi-host replicas need shared storage or S3.

The API serves only copies of keys under `public/`, with encoded keys. Never expose
the entire objects or metadata directory through a static server. See
[local production](../storage/configuration.md#local-production)
for the volume/backup/public-file contract and independent monitoring settings.

## Adopting on an existing database

If the target DB already has the schema, baseline it once so Prisma records the
applied migrations instead of trying to re-create them:

```bash
prisma migrate resolve --applied <migration_name>   # repeat per already-applied migration
```

This is a one-time adoption step, not part of normal deploys.

## Rollback

Prisma has no automatic down-migration. Roll back by **restoring from
backup** (see [Backup & Restore](backup-restore.md)) or by shipping a
**forward-fix** migration. Destructive migrations (dropping/renaming
columns) require app-compatibility planning — deploy a backward-compatible app
first, migrate, then remove the old path in a later release.

For a failed migration, stop rollout and competing writers. Retain its name and
the error, then run `migrate status` through the same migrator image, URL and
configuration. Inspect the ledger through a trusted connection to that database:

```sql
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at
FROM public._prisma_migrations
ORDER BY started_at;
```

Compare the failed SQL with actual objects and affected data. A failed command
can leave committed changes. Replacing the image or running `migrate resolve`
does not undo them. Prepare a state-specific reconciliation or verified restore
before retrying. Do not invent destructive repair SQL when the state is unknown.
Use `resolve --rolled-back <failed-migration-name>` only when the database has
been reconciled for retry. Use `--applied` only after independently confirming
that all intended SQL effects are present. Neither flag checks those facts for
you. Preserve the Tini entrypoint and use the full local CLI command as shown in
the [migration guide](migrator-image.md#supported-configuration-boundary).
Confirm status, schema/data and application compatibility before resuming rollout.

## Seeding

Production rollout runs `migrate deploy` without an implicit seed. A clean database
has no organization role templates after migration; before organization creation,
an operator must explicitly initialize them on the selected target. The guarded
authorization seed accepts clean databases or exact current templates; installed
legacy policies require the [controlled authorization upgrade](../auth/authorization-upgrade.md).

`pnpm --filter api db:seed` runs both authorization initialization and AI catalogue
upserts. Review both effects before using it on an installation: exact current
authorization templates are unchanged, but AI catalogue defaults are reapplied.
It is not a routine production migration or a repair command.

### Seed from the API image (deployment)

Run the seed as a one-shot container from the same API image as the deployment. The
host needs no source checkout, Node.js or pnpm, and the database needs no host port:

```sh
docker compose --profile seed run --rm system-seed
```

Without Compose, run the API image with `node dist/cli/system-seed.js --url-from-env MIGRATION_DATABASE_URL`
and that variable set for this container only.

- The `system-seed` service receives only `NODE_ENV` and `MIGRATION_DATABASE_URL` from `.env`;
  `api` and `worker` never receive the owner URL. Anyone who can inspect containers on
  the host can still read it, as with every container environment.
- `MIGRATION_DATABASE_URL` names the migration (owner) role from
  [role separation](database-role-separation.md), not a superuser. With
  `NODE_ENV=production`, it must use `sslmode=verify-full`; with the bundled
  Postgres, use the TLS overlay's CA path (see [Single-host production](single-host-compose.md#3-complete-env)).
- The database must already be running and migrated: `run` starts Postgres if it is
  bundled and stopped, but never runs migrations.
- The last output line is JSON. Exit codes:

| Exit | Output `status`                                                              | Meaning and next step                                                                                                      |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0    | `seeded`                                                                     | Role templates exist, AI catalogue defaults are applied.                                                                   |
| 2    | `invalid_input`                                                              | The variable is empty, not a Postgres URL, or lacks `verify-full` in production. Fix `.env`.                               |
| 3    | `TEMPLATES_REQUIRE_MIGRATION`, `TEMPLATES_AMBIGUOUS`, `PERMISSION_COLLISION` | Installed authorization data differs. Nothing was changed; use the [controlled upgrade](../auth/authorization-upgrade.md). |
| 3    | `SEED_FAILED` (with `sqlState` when the database reported one)               | Connection, TLS or permission failure (`42501` = missing privilege). Fix the cause and run again.                          |

The output never contains the URL or the driver's message. The role templates are
written in one transaction; the AI catalogue then follows as separate upserts without a
shared transaction. A failure in the catalogue part can leave it partly applied, with
the role templates complete; running the seed again after fixing the cause completes it. Each run
re-applies the catalogue defaults (enabled flags, default model, non-secret
configuration), so do not use it to repair a live installation.

### Seed from a source checkout (development)

The same seed runs from a source checkout matching the deployed version and the
Node/pnpm versions declared by its root `package.json`.
Prepare dependencies and the seed's generated/shared imports:

```sh
export pnpm_config_frozen_lockfile=true
pnpm install --frozen-lockfile
pnpm --filter @amcore/shared build
pnpm --filter api db:generate
```

Provide `MIGRATION_DATABASE_URL` through your normal secret handling. It must name
the selected direct endpoint reachable from this host, use the schema-owner role,
and retain the required TLS verification and trusted CA. Compose env files do not
configure host commands; the container-only hostname `postgres` is not a host endpoint.

The source seed connects through **node-postgres**, not Prisma's native CLI.
Prepare a host seed URL for that driver while keeping the selected database and
schema-owner credential. Use `sslmode=verify-full` to verify the certificate and
hostname. For a custom CA, use `sslrootcert` with a readable absolute **host**
file path. For example, the URL query includes:

```text
sslmode=verify-full&sslrootcert=%2Fabsolute%2Fhost%2Fpath%2Fmigration-ca.pem
```

For a server certificate trusted by Node's default CA store, `sslmode=verify-full`
needs no custom `sslrootcert`. In node-postgres, `sslcert` identifies a **client
certificate**, not a trusted root CA; Prisma's `sslaccept` does not configure this
driver. Do not copy the migrator's container CA path or TLS parameters unchanged.
Keep certificate and hostname verification enabled; do not bypass a TLS refusal.
See the [node-postgres connection-string reference](https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string#tcp-connections).
Supply the completed URL through the same secret handling, without logging it.

```sh
: "${MIGRATION_DATABASE_URL:?set the selected host-reachable migration URL first}"
DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm --filter api exec tsx prisma/seed.ts
```

This invokes the same guarded seed directly, with the explicitly selected URL.
The migrator image does not contain the seed; the API image does (see above).
Stop on a connection, TLS, permission or template refusal; do not switch targets
or bypass verification. A successful seed prints `System roles and AI catalogue seeded`.
Before initial setup, use the runner's documented `status` command to confirm
readiness. Status does not verify every database privilege or every AI catalogue field.

## Initial organization and administrator

Migration `20261015150000_organization_establishment` adds two minimal permanent result
tables without backfilling memberships or granting roles. Existing installations are
not adopted as initial setup. Runtime DML/default privileges must cover the new tables.
Application rollback leaves these additive tables and completion facts intact.

After explicit guarded seed, choose the independent signup and creation policies.
A fixed company sets `ORG_SELF_SERVICE_CREATION_ENABLED=false` consistently on every
API replica. In reference Compose, set it in the project `.env` or the file selected
with `--env-file`; the common backend environment forwards it to `api` and `worker`.
An omitted setting defaults to `true`. A one-off setup command using the `api`
service inherits the same policy; it does not reconfigure existing API replicas.
Roll out that policy consistently before admitting traffic or running initial setup.
Approve [recipients and a send budget](../email/delivery.md#verify-delivery-on-a-deployed-stack)
before creating an account or requesting recovery. Prepare an ordinary account,
complete normal mailbox proof, then assign
its verified ID as organization `ADMIN`. Run `organization-setup.js` from the runner;
migrations use the migrator. The explicit seed runs from the API image, as described
under [Seeding](#seeding). First platform `SUPER_ADMIN` trust
is separate. The [establishment runbook](../product-admin/organization-establishment.md)
gives exact image commands, prerequisites, status/exit codes and failure recovery.

Setup serializes its initial checks with ordinary organization writers. A Console
operator does not stop writes. This short transaction is not a permanent singleton
policy: a stale creation-enabled replica can create another company after commit.
Keep minimal completion records across deletion, cleanup, backups and application
rollback. Never delete them as an ordinary retry procedure.

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

**Queue board.** The API serves a view-only Bull Board under `/api/v1/admin/queues` on the roles
`web` and `all`, never on `worker`. In production it is off until `ENABLE_BULL_BOARD=true` is set
in the environment of the API process (a `.env` file cannot enable it: the decision is taken
before `.env` is read) and the API is restarted. Enabling it does not allow any action; the
retired `BULL_BOARD_READ_ONLY` variable is ignored. A proxy in front of the API must not cache
that path. See the
[queue guide](../../apps/api/src/infrastructure/queue/README.md#bull-board-dashboard).

Background work is registered once through the
[backend registration contract](../backend/background-work.md). Deploy its PG
migration before producers/workers start. Worker handlers start after readiness
guards; the web role has no executable managed handler. Administrative commands
require PG intent/budgets/strict audit even for broker-owned jobs. Unknown commands
are not redispatched after transport or finalization failure.

Each process has one bounded control connection owner with at most4 short leases;
rendering, provider I/O and PG transactions do not hold those leases. Managed queue
pause/resume has no backlog-count ceiling. Individual job controls require a
supported membership layout with at most4096 entries in each inspected primary
list. See the [queue runbook](runbooks/queues.md) for recovery rather than invoking
stock queue mutation methods.

Broker control failure leaves PG-owned durable control available when its other
request dependencies are healthy. Total Redis failure can also affect authentication,
the pre-auth rate-limit backstop and the frontend session vault; a PG-only business
transaction does not promise browser availability during that outage. Conservative welcome
execution additionally requires independent PG evidence and an immutable Redis
request. See [queued-email safety](../email/queued-safety.md) for local freshness checks,
transport limits, retention and non-evicting uncertainty capacity.

Multi-instance safety is already in place, and the two cron flavors are
deliberate. The nightly **cleanup** and **notification-retention** sweeps are
Redis-lock-guarded (only one replica runs each; a skipped run self-repairs the
next night). The **notification-dispatch recovery** cron is the exception: it runs
on **every** worker replica and is _not_ lock-guarded — that is intentional
(`SingletonCronRunner` is fail-closed on a Redis hiccup, exactly when recovery is
needed), and Postgres `FOR UPDATE SKIP LOCKED` is the coordinator, so replicas
drain disjoint rows without double-sending. The throttler is Redis-backed and
BullMQ workers consume one shared queue. Add worker replicas freely. Each process
records the result of its scheduled jobs for the Console
Scheduled jobs screen of the optional Console. Recording is
best-effort: one background write at a time, started only when the pool has a
free connection and no request is waiting for one, and skipped when
`DATABASE_POOL_MAX` is 1.

### Graceful shutdown

On `SIGTERM` Nest runs the destroy hooks, then the platform kills the process once
its **termination grace** runs out. The reference `docker-compose.yml` sets
`stop_grace_period: 30s` on `api` and `worker` (Docker's default is 10 s, which is
shorter than the worker needs); in Kubernetes the pod default is
`terminationGracePeriodSeconds: 30`. Set it explicitly for your own platform and
raise it if you add slow shutdown steps — nothing in the repository can verify a
live deployment's value.

Before stopping the whole stack, suspend deployment automation, scheduled jobs and
operator commands that can start new database or Redis clients. Keep PostgreSQL
and Redis running until all clients finish. A single `stop` command with all
service names does not establish this order. Use the original project, files and
profiles throughout, including `backup` when enabled.

1. Stop application clients and inspect their logs and exit states:

   ```bash
   docker compose stop caddy api web worker
   docker compose ps -a
   docker compose logs --tail=100 api worker
   ```

   Investigate unexplained crashes before continuing. Inventory active one-off
   containers too, including migration, seed, restore and operator SQL commands.
   Wait for each operation to finish and inspect its exit state and result. Do not
   interrupt a migration or restore merely to advance shutdown. If its outcome is
   uncertain, keep the infrastructure running and resolve that operation first.

2. Stop the optional backup service while PostgreSQL is still available. If a new
   complete backup is required, first wait for the matching `[backup] completed`
   log and record its exact `.dump` filename. Then stop the service:

   ```bash
   docker compose logs --tail=100 backup
   docker compose stop backup
   docker compose ps -a backup
   ```

   Skip these commands if no backup service exists. An idle service is stopped
   too, so it cannot start another dump. Stopping during `pg_dump` can leave a
   `.dump.tmp` file; never treat that partial file as a completed backup. Confirm
   the selected `.dump` has a matching completion log and validate it through the
   [backup verification procedure](backup-restore.md#restore-drill-rehearsing-a-restore-not-just-taking-one).
   A successful stop does not certify an archive or imply successful backup work.

3. Verify that no clients remain, including external schedulers, SQL shells,
   backup tools and Redis consumers. `docker compose ps -a` must show no running
   project database/Redis client, including one-off containers. On a trusted
   PostgreSQL administrator connection, the following query must return no rows:

   ```sql
   SELECT pid, usename, datname, application_name, state
   FROM pg_stat_activity
   WHERE backend_type = 'client backend' AND pid <> pg_backend_pid();
   ```

   Check Redis `CLIENT LIST` through its approved administrator connection; only
   that inspection connection may remain. Close the inspection connections after
   checking. If clients remain or reconnect, identify and stop their owners before
   proceeding. Do not kill unknown sessions to bypass this check.

4. Only after these checks, stop the bundled infrastructure:

   ```bash
   docker compose stop postgres redis
   ```

The application owns its PostgreSQL pool error listener through adapter disconnect
and pool teardown. An idle connection failure logs `prisma.pool_error` with
`phase` (`runtime` or `shutdown`) and a bounded `sqlState`, without client details.
The driver discards the failed idle connection. Runtime queries can acquire a new
connection; query failures still reject. Investigate runtime failures and unexpected
shutdown errors rather than treating the log as proof of successful shutdown.

What the worker does within that budget:

1. The **notification dispatcher** and the **AI run dispatcher close**: each
   starts no new claims, sends, runs or recovery passes, and lets work already in
   flight record its result.
2. Within **15 seconds** (`NOTIFICATION_PROVIDER_TIMEOUT_MS + 5 s` for
   notifications, 15 s for AI runs), or earlier once the logical work finishes, each
   dispatcher **seals**: nothing new starts and every wait on in-flight work is
   released, so the BullMQ worker is not held open by that work. A database
   transaction interrupted between two dependent writes is rolled back as a whole.
   Sealing also aborts in-flight AI provider calls.
3. `PrismaService` synchronously closes its private catalogue/diagnosis capabilities
   before running consumer barriers. The two lazy clients share its existing pool;
   they create no additional connection quota. Their disconnect gets a reserved
   2 s of the aggregate 20 s barrier/child-cleanup budget, then main-client disconnect
   and pool teardown are attempted. This bounds waiting, not physical completion.
   A hung acquisition/cleanup may require the supervisor's final process termination.

An unknown physical completion quarantines only the named capability and logs
`prisma.observed_transaction_quarantined` with a bounded consumer name. Restart
that process after investigating the DB/driver problem; elapsed cooldown never
resets the physical token. Destroying a suspect connection likewise does not
invent acknowledged rollback. Main-client traffic retains the ordinary pool policy.

A delivery whose result was not recorded is recovered by lease expiry and the
lease reaper on the next worker (it may be sent again — notification delivery is
at-least-once), provided its claim committed. An issued transaction may still
commit or roll back after the seal; its outcome is unknown until it settles. A
rolled-back claim leaves the delivery pending, and a committed finalize needs no
reaper. Shutdown attempts to abort provider requests, but an adapter may
ignore abort and an already accepted message cannot be recalled. Requests still
pending at process termination end with the process. An AI run whose result was
not recorded keeps its lease and is recovered by lease expiry on the next worker
(the model call may be repeated; a tool call whose effect may have happened is
**not** repeated — the run fails `tool_effect_unknown`). The 15 s bounds cover
notification and AI run work only: they do not bound
Redis cleanup, other queues, the HTTP server or the database disconnect, so budget
those separately inside the platform's grace period.

## TLS & reverse proxy

AMCore's Node process speaks plain HTTP; TLS terminates at the **edge** — a
reverse proxy, your cloud load balancer, or a Kubernetes Ingress — never inside
the app. There is no in-app certificate management. `@fastify/helmet`
(the HTTP bootstrap in `apps/api/src/bootstrap/configure-http.ts`) sets security-header
defaults for API routes after parser admission. The queue board owns its separate
policy. This API bootstrap never touches the HTML `apps/web` serves, so it does not
cover the browser-facing origin. `apps/web`'s own browser
security-header baseline (static headers, HSTS, nonce-based CSP) is a
separate mechanism — see
[Browser security headers and CSP](../frontend/browser-security-and-csp.md)
and the CSP nonce-propagation requirement below.

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
   makes Fastify trust the configured proxies rather than the whole
   `X-Forwarded-For` chain. Leaving `TRUST_PROXY=false` behind a proxy that
   already sanitizes headers is safe, but audit/request logs then record the
   proxy's own IP, not the client's. Avoid broad `TRUST_PROXY=true` unless the
   edge is guaranteed to sanitize (not append to) forwarded headers.

### BFF client-IP relay (`apps/web` → `apps/api`) — a separate contract from `TRUST_PROXY`

`TRUST_PROXY` above governs only the edge → app hop. Browser traffic
proxied through `apps/web`'s BFF (ADR-068) is a _second_, internal hop
(`apps/web`'s Route Handler → `apps/api`, typically over the compose/private
network) that `TRUST_PROXY` says nothing about — without additional
configuration, the global throttler sees every BFF-proxied visitor as the
same address (the `web` container's), and `req.ip`/audit-log IP for that hop
reflect the same limitation.

ADR-072 adds an **independent, opt-in** two-key contract for this hop,
disabled by default so a fresh checkout is unaffected:

- **`WEB_TRUSTED_CLIENT_IP_HEADER`** (`apps/web`) — names a single inbound
  header (`x-real-ip`, `x-forwarded-for`, `cf-connecting-ip`,
  `true-client-ip`, or `fastly-client-ip`) that `apps/web` itself trusts as
  the real visitor IP, from whatever edge terminates TLS in front of
  `apps/web`. Enable this only when that edge overwrites (never appends to)
  the named header — the same rule as `TRUST_PROXY` above, one hop further
  out. `apps/web` relays the resolved value to `apps/api` as a new,
  purpose-specific `X-AMCore-Client-Ip` header; a browser can never set this
  header itself (stripped unconditionally, regardless of configuration).
- **`TRUSTED_WEB_PEERS`** (`apps/api`) — names the real socket address(es)
  `apps/web` connects from (a preset, IP, or CIDR — same grammar as
  `TRUST_PROXY`'s presets). The global `RateLimitGuard`'s tracker resolver
  trusts `X-AMCore-Client-Ip` only when the inbound request's actual TCP
  peer (not a forwarded header) matches this set; otherwise it falls back
  to stock `req.ip`, identical to before ADR-072.

**Both must be set for either to have an effect.**

**Every edge in front of `apps/api` must strip `X-AMCore-Client-Ip`.** The API
accepts the header from any socket address in `TRUSTED_WEB_PEERS`. If that set
includes the edge itself (a broad range such as `uniquelocal`, or the Docker
gateway a host nginx connects from), a client could send the header through the
edge and choose its own address. The bundled Caddyfiles and the reference nginx
config below strip it. Set `TRUSTED_WEB_PEERS` to the exact web address only; with
the reference Compose stack, `docker/compose/bff-relay.yml` does this (see
[Single-host production](single-host-compose.md#visitor-ip-through-the-web-bff)).

The relay consumers are the global throttler, Session metadata, password login
and password step-up. Password accounting resolves the verified visitor address
once per attempt, then falls back to req.ip/socket. Audit/getClientIp and invite
abuse keep their existing inputs; global req.ip is not rewritten.

### CSP nonce propagation — preserve the Proxy-added request header

`apps/web`'s Content Security Policy nonces Next's own framework-injected
scripts. Next extracts that nonce from the
**request's** `Content-Security-Policy` / `-Report-Only` header, not the
response — this is a Next.js implementation detail, verified against the
installed framework source, not a configuration choice AMCore made.

`src/proxy.ts` generates this CSP request header after deleting any
hostile or stray inbound CSP headers. A normal outer reverse proxy in front
of `apps/web` is not expected to create or trust a client-supplied CSP
request header.

The requirement applies to the internal path after Proxy has run: if your
hosting platform, CDN adapter, or custom edge setup executes Next Proxy at
one layer and renders the App Router page at another, that Proxy-modified
request header must survive the Proxy -> renderer hop. Several WAFs and
CDNs strip security-looking headers by default when forwarding requests; if
one sits on this internal path or if you move CSP generation to your own
edge, Next silently emits framework scripts with no nonce at all, and the
app fails to hydrate the moment `WEB_CSP_MODE` is `enforce` (AMCore's
production default). Verify this against the deployed artifact before
relying on enforcement: a normal page response should contain matching CSP
and script nonces, with no bare Next framework `<script>` tags.

Full policy, enforcement mode, and how to add a third-party origin:
[Browser security headers and CSP](../frontend/browser-security-and-csp.md).

**The reference `docker-compose.yml` closes the BFF/API topology gap
described above.** `api`'s published port binds to `127.0.0.1` by default (not
`0.0.0.0`) — reachable as `localhost:5002` on the compose host for local
dev, but not from another host or the internet. This removes the
"multiple, different-length paths to the app" condition the `TRUST_PROXY`
numeric-hop warning above describes: with the default, the _only_ path to
`apps/api` from outside the host is through whatever edge you run (the
bundled Caddy profile and the documented nginx config both already reach
`api` by its Docker network name, never through this published port, so
neither depends on it being broader). If you override
`API_PUBLISH_HOST=0.0.0.0` (`.env.example`) — e.g. an external reverse
proxy that is _not_ on this compose network — you re-open that condition
yourself and must firewall the port independently; don't pair a broad
`TRUSTED_WEB_PEERS` range with that override unless you have.

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
        proxy_set_header Host $http_host;
        # Never forward a client's BFF relay claim (see "BFF client-IP relay").
        proxy_set_header X-AMCore-Client-Ip "";
    }

    # SSE endpoints (see "Realtime SSE behind a proxy" below) need buffering
    # off and a read timeout above the heartbeat interval.
    location ~ ^/(api/v1/notifications/stream|api/v1/ai/runs/.+/stream)$ {
        proxy_pass http://api:5002;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Host $http_host;
        proxy_set_header X-AMCore-Client-Ip "";
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
`TRUST_PROXY` is set to the exact trusted hop count/CIDR (so Fastify trusts
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

The base `docker/caddy/Caddyfile` remains API-only and therefore preserves the
existing edge contract. For product-web path mode, set `CADDY_WEB_DOMAIN=app.example.com`
in `.env` and append `docker/compose/web.yml` to the installation's saved `COMPOSE_FILE`.
Keep its production, TLS and private overrides. Start or update through the
[ordered rollout](#production-rollout-via-registry-image-pull-path).

`docker/caddy/Caddyfile.web` fronts the product web host but creates no
console hostname. All bundled Caddyfiles strip `X-AMCore-Client-Ip` toward the API
and leave Caddy's default `X-Forwarded-For` handling (the client's address, never a
client-supplied value). Add `docker/compose/bff-relay.yml` to relay visitor
addresses from the web app to the API; see
[Single-host production](single-host-compose.md#visitor-ip-through-the-web-bff). **OAuth login needs the product web host fronted**: per
`docs/auth/oauth.md`'s ADR-068 note, provider callback URLs
(`GOOGLE_CALLBACK_URL` etc.) point at `apps/web`'s own origin, not `api`'s —
fronting only `api:5002` leaves OAuth's callback URL unreachable.

### Operations Console host-mode reference

When the generated console config selects `host`, select the matching Caddy
configuration explicitly: use `docker/compose/console-host.yml` instead of `web.yml`
in the saved `COMPOSE_FILE`, preserving every other overlay. Set both hostnames
in `.env`:

```bash
CADDY_WEB_DOMAIN="app.example.com"
ADMIN_CONSOLE_HOSTNAME="console.example.com"
```

Use the [ordered rollout](#production-rollout-via-registry-image-pull-path), not a
shortened `-f` selection that drops production or TLS settings.

The override mounts `docker/caddy/Caddyfile.console-host`; it is the only
reference Caddyfile that creates a console host. An absent hostname makes that
file fail validation rather than creating a placeholder vhost. The Next
container also validates the hostname at startup. Keep `web` private:
the reference Compose mapping binds it to `127.0.0.1` by default, and Caddy or
nginx reaches `web:3000` over the Compose network. Setting
`WEB_PUBLISH_HOST=0.0.0.0` is an operator-owned exception that requires an
independent firewall.

For the console hostname, both reference proxies apply the same mapping:

| Public request                      | Next upstream                                                        |
| ----------------------------------- | -------------------------------------------------------------------- |
| `/{locale}/.../`                    | external `308` to the same public path without `/` (query preserved) |
| `/{locale}/...`                     | `/{locale}/admin/...`                                                |
| `/api/...`                          | `/api/console/...` (the leading `/api/` only)                        |
| `/api/csp-report`                   | unchanged                                                            |
| `/_next/...` and top-level metadata | unchanged                                                            |

The mapping rewrites only the leading `/api/`: the queue board's own data paths
(`/api/bull-board/api/queues`) contain a second one that must reach the application unchanged.
The nginx reference anchors its rewrite at the start of the path; the Caddy reference gives
`uri replace` a limit of 1 (without it Caddy replaces every occurrence). Keep both properties in a
custom edge. One exception is explicit in both references: the board's root `/api/bull-board/`
(with the slash, its page base) is mapped straight to `/api/console/bull-board`, because Next.js
would otherwise redirect it to the slashless address and that redirect would name the physical
`/api/console/` path.

`docker/nginx/operations-console.conf` is the nginx reference include. Its
default TLS vhost rejects unmatched hosts, and both vhosts forward the exact
`Host` header, including an explicit external port. The web BFF matches this
authority against configured trusted origins; preserve it (`$http_host` in nginx,
`{hostport}` in Caddy) instead of stripping a non-default port or trusting
browser-supplied forwarded headers. `docker/caddy/Caddyfile.console-host` carries the equivalent
Caddy block and rejects unmatched HTTP hosts before proxying.
The trailing-slash redirect runs before the internal page mapping, so an
upstream redirect cannot expose `/{locale}/admin/...` as a public location.
Nginx rejects encoded traversal before mapping. Both references reject direct
physical `/admin` paths; Caddy also catches normalized traversal there. Neither
check applies to query strings.
The console application checks that header only in host mode; the proxy and
private container network are the trust boundary, not a raw client header.

The console BFF's `GET /api/console/access` relays only the empty status from
the API's bearer-only `GET /api/v1/admin/access` policy probe: `204` for a live
`SUPER_ADMIN`, `401` or `403` for denial, and `503` for an unavailable or
unexpected upstream. It never returns profile or role data. Every future data
target needs its own API-side `SUPER_ADMIN` guard; page admission is not data
authorization. `/api/csp-report` is intentionally not a console BFF target and
remains the existing unauthenticated CSP-report receiver.

Host-mode console login and logout use public `/api/auth/login` and
`/api/auth/logout` paths; the selected proxy maps them internally to the fixed
`app/api/console/auth/**` namespace. They set only the host-only
`__Host-amcore_console_session` cookie and use the separate
`web:console-session:v1:*` Redis namespace. Do not expose the physical
`/api/console/**` paths publicly on the console host, and do not share the
product `amcore_session` cookie or its Redis entries with this boundary.

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
  (`amcore` BullMQ prefix, `ratelimit:v1:*` (ADR-073), `auth:*`, `rate:*`).
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

## See also

This page is the VPS/Compose entry point; the rest of the production
readiness surface lives in sibling docs rather than growing this one
indefinitely:

- [Production deploy profile](production-deploy-profile.md) — the
  build-once/promote-by-digest contract and GitHub Environments/secrets
  checklist this page's registry rollout follows.
- [Database role separation](database-role-separation.md) — a
  migrator/owner role distinct from the app's DML-only runtime role.
- [Backup & restore](backup-restore.md) — which backup strategy fits your
  deployment, and the `restore-drill` profile that rehearses an actual
  restore.
- [PostgreSQL major-version upgrade](postgresql-major-upgrade.md) — moving
  an existing deployment to a new PostgreSQL major (e.g. 16 → 18); not the
  same as the routine migration/rollout above.
- [Secret rotation](secret-rotation.md) — rotating `JWT_SECRET`, database
  credentials, `REDIS_URL`, OAuth secrets, and third-party API keys once
  they're already running in production.
- [Deployment platforms](deployment-platforms.md) — a decision matrix for
  Kubernetes, Cloud Run, Fly, Render, Railway, and (with a hard caveat)
  Vercel, if VPS/Compose isn't your target.

## AMCore API keys

API-key retained revocation requires a drained, all-process cutover. Follow the
[API-key lifecycle runbook](api-key-lifecycle.md) before this schema upgrade;
mixed old/new writers and direct old-version rollback are unsupported.

## Runtime settings rollout

Use a drained, all-process cutover when introducing the
[runtime settings reader](../backend/settings.md). Before deployment, verify a
restorable database backup and align API/worker deployment baselines if reset
must produce one interval. Apply the settings migration through the production
one-shot migration step, then update every API, worker and web process. Admit
runtime-setting writes only after this cutover is complete. Check startup,
settings GET, process-local application events and Audit reads before reopening
operator writes. The migration is additive, but the supported rollout is not a
mixed-version compatibility guarantee.

A pre-settings API/worker binary has no reader: it continues to use env and
ignores saved overrides. Older API/web audit contracts also reject the new
`RUNTIME_SETTING` target. Once settings audit events exist, direct rollback to a
pre-settings release is unsupported. Reset does not restore compatibility: it
preserves earlier events and can create another settings event. Prefer forward
repair. Any rollback needs a separately tested compatible API/web/worker set and
an explicit backup/data-impact plan; preserving the table alone is insufficient.
Do not delete audit events, rewind revisions or reverse migrations as a workaround.

For settings-aware releases, check definition/schema-version compatibility before
rollout or rollback; incompatible readers keep last-confirmed state or use an
unconfirmed baseline and require remediation. After restoring an older database
backup, restart every API/worker reader to initialize its revision from that
backup. See [runtime recovery](../backend/settings.md#rollout-and-recovery).

After a completed rollout, saved changes need no process restart under healthy
reconciliation. A successful operator response certifies the commit and reports
only the responding API's applied state. Console frontend removal leaves this
backend capability, contracts and migration intact.

## Notification delivery control rollout

Drain and stop every old API and worker role before applying
`20261011170000_notification_delivery_control`. Disable automatic restarts during
the maintenance window. Verify a restorable backup first. The migration rejects
known application connections; it cannot detect every differently named writer.
Start the compatible API, worker and web set after migration. Verify the seeded
claim authority, durable work registration and recovery poller before admitting
operator commands. Mixed old/new writers are unsupported.

Historical attempted deliveries become legacy-unverified. Do not clear their
uncertainty to enable retries. Rollback requires restoring the verified backup
with a compatible process set; prefer forward repair. See
[notification delivery control](../notifications/control.md#upgrade).

## API module boundary

The API emits ESM. Preserve its `package.json` with `type: module` alongside
`dist`, runtime dependencies and the current shared package. The standard image
build runs native type checking before emission. Do not deploy output from a
failed build. See [API build and ESM runtime](../backend/api-build.md).

## Operator organization provisioning

After trusted SUPER_ADMIN access, migrations and guarded role initialization, use [organization provisioning](../product-admin/organization-provisioning.md) for the first or later organization. In production configure `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` and public product `FRONTEND_URL`; the reference Compose forwards these to API and worker. Apply configuration to every API replica. `production` with `mock` rejects new operator administrator invitations before commit. Real-provider failure after commit retains the organization for explicit recovery. Console-disabled installations use the same protected backend API.

## Password limiter upgrade and rollback

This auth change retains existing Redis key names, Keyv JSON envelopes and expiry
policy. It replaces get/set writers with atomic scripts. Mixed old/new writers are
unsafe: old success still clears aggregate debt and old failures can lose updates.

For the reference Compose deployment, take the web/API entry routes out of service
and allow active auth requests to finish. Record the old container IDs first.
Then use `docker compose stop web api worker`; keep automatic restarts disabled
for those old artifacts. Confirm all recorded old processes are stopped and their
Redis connections have closed. If you cannot establish that boundary, keep traffic
closed and resolve it before replacing writers. A health check alone is not drain
proof. Other deployment platforms must provide equivalent stop/drain evidence.

1. Temporarily stop new auth/session mutations at the deployment boundary.
2. Drain in-flight web/API auth work.
3. Replace all old web/API writers with the reviewed compatible artifacts.
4. Start the compatible set (`docker compose up -d --no-deps api worker web` in
   the reference stack). Verify readiness before reopening traffic. Use a safe
   account to check login 200 and step-up 200; use an isolated test fixture for
   password-limit 429 and protection-unavailable 503. Both rejections must return
   no new credentials. Do not exhaust real users' budgets as a rollout probe.

Do not flush Redis, reseed keys or run background conversion. Same-address counts
and blocks remain readable without a new namespace. For BFF traffic that changes
identity from web peer to visitor, old shared debt cannot be attributed per visitor.
An existing visitor key retains its debt; an absent visitor key starts a fresh
budget. Old peer blocks no longer apply to those newly identified visitors.
Let old keys expire normally; do not copy shared debt to every visitor.

Rollback also stops/drains writers before replacing binaries. Old binaries can
read the compatible envelopes but restore the old accounting/reset behavior.
They do not inherit debt stored only under new visitor identities. If deployment
requires uninterrupted conservative debt continuity, postpone rollout for a
separately reviewed migration design. Automatic retries cannot repair attribution.

Here, “debt” means retained failed-attempt counts and blocks.

Redis operations have a 500 ms total async budget, including cleanup, under a
progressing event loop. The process-wide 32-operation cap includes closing clients.
Unconfirmed closures retain capacity; exhaustion fails closed with 503 until closure
or process recovery. A timeout after dispatch can leave counter effects unknown;
no session/step-up token is issued and no Redis update is replayed. These bounds
apply per limiter operation, not the entire HTTP/password request.

For continuing limiter 503 responses, first check API readiness and Redis connectivity
using the existing health/runbook procedures. Readiness does not prove free limiter
capacity. This change adds no limiter-specific production metric. Inspect 503 rates
and Redis client connections before restarting anything. If Redis is healthy but
unconfirmed client closures still exhaust capacity, stop/drain the affected API
process and restart the same compatible artifact. Verify login/step-up recovery.
Restarting releases process resources; it does not undo an already executed update.
Never clear Redis to recover capacity or replay an uncertain counter update.
