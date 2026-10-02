# Storage Configuration

Storage is configured entirely through environment variables and validated at
startup.

## Driver Selection

| Environment     | Default driver | Why                                                            |
| --------------- | -------------- | -------------------------------------------------------------- |
| `production`    | `s3`           | Fails fast unless a real bucket and credentials are configured |
| `test`          | `memory`       | Fast deterministic unit tests                                  |
| everything else | `local`        | No cloud dependency during development                         |

This table applies when `STORAGE_DRIVER` is **unset in the API environment**.
The reference Docker Compose file supplies `local` by default, including when
`NODE_ENV=production`. Set `STORAGE_DRIVER` explicitly for each production
deployment: `local` for the shared persistent volume below, or `s3` with bucket
credentials. Do not rely on the runtime-mode default to select storage in Compose.

Override with:

```env
STORAGE_DRIVER=s3 # s3 | local | memory
```

## S3-Compatible Storage

Required when `STORAGE_DRIVER=s3`:

```env
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

Optional but common:

```env
STORAGE_ENDPOINT=
STORAGE_PUBLIC_ENDPOINT=
STORAGE_FORCE_PATH_STYLE=false
STORAGE_SIGNED_URL_DEFAULT_TTL=3600
STORAGE_SIGNED_URL_MAX_TTL=604800
```

`STORAGE_ENDPOINT` is the SDK endpoint. It may be internal or private.
`STORAGE_PUBLIC_ENDPOINT` is the browser-facing public/CDN/S3 API endpoint used
for public URLs and presigning. If it is set, `getPublicUrl(key)` returns:

```text
{STORAGE_PUBLIC_ENDPOINT}/{key}
```

No bucket is synthesized onto a configured public endpoint.

## Provider Examples

### AWS S3

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-east-1
STORAGE_ENDPOINT=
STORAGE_PUBLIC_ENDPOINT=
STORAGE_FORCE_PATH_STYLE=false
```

Public URL shape without `STORAGE_PUBLIC_ENDPOINT`:

```text
https://{bucket}.s3.{region}.amazonaws.com/{key}
```

The current S3 driver uploads `public-read` objects with a `public-read` ACL.
New AWS buckets disable ACLs by default, so those uploads fail with
`AccessControlListNotSupported` unless the bucket deliberately permits ACLs.
For the shipped public-avatar flow, use an ACL-capable bucket with a deliberate
public-access policy, or adapt the S3 provider for policy-based delivery before
using an ACL-disabled bucket. Private uploads and the active file check do not
need a public ACL. A healthy file check does not verify public object delivery.
See [AWS Object Ownership](https://docs.aws.amazon.com/AmazonS3/latest/userguide/managing-acls.html).

### Cloudflare R2

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=auto
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
STORAGE_FORCE_PATH_STYLE=false
```

### DigitalOcean Spaces

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=nyc3
STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

### Yandex Object Storage

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=ru-central1
STORAGE_ENDPOINT=https://storage.yandexcloud.net
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

### Backblaze B2

```env
STORAGE_DRIVER=s3
STORAGE_BUCKET=amcore-prod
STORAGE_REGION=us-west-004
STORAGE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
STORAGE_PUBLIC_ENDPOINT=https://cdn.example.com/assets
```

## Local Driver

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
STORAGE_LOCAL_PUBLIC_BASE_URL=http://localhost:5002/api/v1/storage/public
```

The local driver stores bytes under:

```text
{STORAGE_LOCAL_ROOT}/objects/{key}
```

and metadata sidecars under:

```text
{STORAGE_LOCAL_ROOT}/meta/{key}.json
```

`STORAGE_LOCAL_PUBLIC_BASE_URL` points at the browser-facing API endpoint
`/api/v1/storage/public`; generated URLs encode the object key in `?key=...`.
It must be reachable through your API reverse proxy. Only explicit public copies
are served, with safe content types, attachment disposition, nosniff and sandbox
headers. Public copies explicitly permit cross-origin resource embedding so a
frontend on a different API domain can display images. This does not grant
access to private files. The web starter's CSP still allows images only from
its own origin: expose this public endpoint through the product reverse proxy
under the same origin, or have downstream explicitly allow its trusted public
asset origin in `img-src`. A public API response does not override the page's CSP.
Private objects, metadata and probes are never served. Existing local
public URLs from the old static-mount layout must be migrated; re-upload existing
public objects through the provider to create their public copies before switching
URLs, or perform a controlled visibility-aware migration. Do not continue exposing
the whole objects directory.

### Local production

Explicitly choose `STORAGE_DRIVER=local`. The reference Compose stack mounts the
same named `local_storage` volume at `/app/uploads` in API and worker. The image
creates this directory with runtime uid/gid 1001 ownership, which Docker copies
into a new empty volume. Existing volumes and bind mounts retain their own
permissions: provision ownership before rollout. Do not use world-writable access.
If overriding `STORAGE_LOCAL_ROOT`, mount the same durable storage at the new path
in both services; an environment override alone does not move a volume.

This supports a single-host deployment such as a VPS. Replicas on different hosts
need shared durable storage or S3; identically named local volumes are not shared
across machines. Separate Compose projects also get separate named volumes by
default; plan shared storage or a coordinated file migration before a blue-green
cutover. Preserve the volume during upgrades; `docker compose down -v`
removes it. Back up objects, metadata and public copies consistently while writes
are paused or using a filesystem snapshot. Restore to an isolated deployment and
verify private downloads, public avatars and API/worker access. Database backups
do not include this volume. See [backup/restore](../operations/backup-restore.md).
A successful probe proves current I/O, not persistence after recreation or backups.

## Active file monitoring and readiness

Every API/worker process checks the selected local, S3-compatible or test-memory
driver independently. It writes a 35-byte private canary, reads/compares the bytes
and deletes it. Overview and metrics scrapes only read the cached result.
Overview shows result time and the next scheduled check; an unfinished operation
blocks new checks. A timeout timestamp is publication of the failed verdict, not
proof that underlying I/O or cleanup has completed.

```env
STORAGE_PROBE_INTERVAL_SECONDS=600
STORAGE_PROBE_TIMEOUT_SECONDS=10
STORAGE_PROBE_PREFIX=__amcore_probes__
STORAGE_HEALTH_ENABLED=false
STORAGE_HEALTH_PROBE_KEY=__storage_health_check__
```

Cadence accepts 30–3600 seconds; transaction deadline 1–20 seconds plus a separate
five-second cleanup deadline. Results become stale after three cadences. Startup
has an unmeasured state until completion; success, failure, unknown and stale are
separate. Cancellation is cooperative: unfinished I/O retains the single-operation
slot, so timed-out work cannot accumulate. No deadline promises cancellation of
kernel filesystem operations. Crash/denial can leave a canary; use lifecycle cleanup
only on the dedicated S3 prefix (including noncurrent versions when applicable)
and old-file cleanup only on local `objects/.amcore-probes/` and `meta/.amcore-probes/`.

The deployment baseline is **10 minutes** (`STORAGE_PROBE_INTERVAL_SECONDS=600`).
A saved platform override takes precedence and is adopted without restart.
Use the Overview File storage **Edit** action or the retained
[operator API](../backend/settings.md#operator-api-and-rights). Reset clears the
override and uses each process's validated deployment baseline; align API/worker
values. Save/reset/read never starts a canary. Healthy reconciliation aims for
35 seconds; database/transport failure retains the last confirmed value.
The following request counts assume the default applied interval.
Normal S3 traffic is one PUT, one GET and one DELETE per check per process.
Over 30 days, one API and one worker therefore perform **8,640 operations of each
type** (25,920 requests in total), excluding startup checks, retries and cleanup
after failures. Replicas multiply this traffic; application traffic shares any
provider free allowance. For example, Yandex Object Storage currently includes
10,000 standard write operations and 100,000 reads per month; DELETE is free.
These checks alone use about 86% of its free write allowance for that topology.
Check current [provider pricing](https://yandex.cloud/ru/docs/storage/pricing)
before deployment; other S3-compatible providers have different terms.
Each instance tests its own credentials/mount, including worker. Increasing
the interval reduces cost but delays detection: with checks completing on schedule,
a failure just after a successful check is not seen for about ten minutes at the
default interval. A stalled operation can delay the next check further; its result
eventually becomes stale. The synthetic check complements metrics from actual
user operations. It does not test public/CDN URLs,
backup integrity, persistence across container recreation or S3 capacity.

The active S3 check needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject`
under `{bucket}/{STORAGE_PROBE_PREFIX}/*`. An AWS resource example is
`arn:aws:s3:::example-bucket/__amcore_probes__/*`; compatible providers use their
corresponding policy. The same configured credentials also serve application files:
grant their required object permissions separately. Restricting the credentials
to the diagnostic prefix alone would break user uploads and downloads. The check
needs no ListBucket or public ACL permission. Encryption
policies may additionally require KMS access. Prefix-scoped deployments can select
a dedicated reserved prefix inside their allowed namespace. Do not share it with
user objects. HTTP 403 is an access failure, not proof of a provider outage.

Storage failure does not change API readiness by default. The separate existing
`STORAGE_HEALTH_ENABLED=true` opt-in adds a passive HEAD/exists check to readiness;
it does not trigger a synthetic write per health request. That passive check can
return 403 for a missing S3 key without ListBucket. Configure its key to an existing
readable object or grant appropriate scoped listing access; don't interpret 403 as
"S3 is down". Compose forwards both monitoring and readiness settings.

`amcore_storage_probe_state{driver,state}` and the tested five-minute alert expose
cached failures without user traffic. The five-minute alert hold starts when
monitoring observes a failed result; it does not prove five minutes of continuous
failed I/O. With the default cadence, initial detection plus the hold can take
about fifteen minutes, plus scrape/evaluation delays. A transient failure may
remain reported until the next successful check. Set up a downstream notification receiver
once. For the supplied monitoring harness,
follow [Alertmanager receiver setup](../operations/observability.md#local-verification-harness).
See the [storage runbook](../operations/runbooks/storage.md) for failure recovery.

The optional Console displays the cached file-check result; it does not send alerts.

## Limits

```env
STORAGE_MAX_FILE_SIZE=52428800
STORAGE_SIGNED_URL_MAX_TTL=604800
```

`STORAGE_SIGNED_URL_MAX_TTL` cannot exceed 604800 seconds because SigV4
presigned URLs have a seven-day hard limit.
