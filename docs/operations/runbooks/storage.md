# File storage

Use [Troubleshooting](../../storage/troubleshooting.md) for symptom-by-symptom fixes and
[Testing](../../storage/testing.md#check-a-real-provider-with-storagecheck) to run
`storage:check` against your provider. Provider pages are in the
[provider matrix](../../storage/providers/README.md).

## File diagnostic

`AMCoreStorageProbeFailed` fires after a failed, stale or unmeasured cached
result has remained visible for five minutes. This is a hold on the observed
result, not proof of continuously failing I/O. At the default cadence, a newly
occurring failure can take about fifteen minutes to trigger the alert, plus
scrape/evaluation delays; recovery is observed on the next successful check. The API and worker independently write/read/delete a
small isolated file once every ten minutes by default. Per-instance failures are
visible through metrics. Notification delivery requires
one-time receiver configuration in Alertmanager or the downstream monitoring
system.

The optional Console Overview reads the cached result of the responding API.
An open Console page does not itself send notifications.

```promql
max without (state) (amcore_storage_probe_state{state=~"failed|stale|unknown"}) == 1
```

1. Identify the affected `instance` and `driver`, then inspect its
   `storage_probe_failed` log event. Check scrape availability
   separately: an absent scrape is not a healthy storage result.
2. For access denial, verify the selected credentials can PutObject, GetObject
   and DeleteObject under `STORAGE_PROBE_PREFIX`. A 403 does not establish that
   S3 is down. Missing-key HEAD can return 403 without ListBucket; the active
   diagnostic does not require HEAD/ListBucket. Encrypted buckets can also need
   KMS permissions imposed by their policy.
3. For local files, check the volume is mounted at `STORAGE_LOCAL_ROOT`, writable
   by runtime uid 1001, shared with worker and has space/inodes. Do not chmod the
   entire tree world-writable. Root-disk facts do not describe a separate mount.
4. For timeout/I/O errors, check endpoint/DNS/TLS, provider incidents, network
   policy and local mount health. A stale result can mean underlying I/O never
   settled; no new probe overlaps unfinished work.
5. Restore the dependency or permissions, wait for the next check and confirm
   healthy state on each affected instance. Verify a real application file flow.
   API readiness stays independent unless explicitly opted in.

The canary is private and isolated from user files. Deletion is attempted even
on failures; delete denial prevents success. Process death or unavailable storage
can leave a tiny canary. Configure prefix-only lifecycle cleanup for S3, including
noncurrent versions when versioning is enabled, or periodically remove old files
only inside the local reserved `.amcore-probes` folders inside objects/meta. Never apply this cleanup to user
objects. A successful canary does not prove backups, persistent mounts across
container recreation or capacity of S3. Public delivery has its own check, see [Public delivery](#public-delivery).

## Public delivery

`AMCoreStoragePublicDeliveryFailed` (ticket) fires when the public-delivery check has
been failed, stale or unmeasured for five minutes. The check runs on every API process
with the `s3` driver (a dedicated worker skips it). After one idempotent write of two fixed canary
objects at start-up it only **reads**, once per `STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS`
(one hour by default): it fetches the public canary from `STORAGE_PUBLIC_BASE_URL` as an
anonymous browser would, and it asks the storage API for the private canary without
credentials. It never affects API readiness.

```promql
max without (state) (amcore_storage_public_check_state{state=~"failed|stale|unknown"}) == 1
```

1. Find the affected `instance`, then read its `storage_public_check_failed` log event.
   The `stage` and `failure` fields say what happened:

   | `stage` / `failure`                  | Meaning                                                      | First action                                                                 |
   | ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
   | `public_read` / `public_not_served`  | The public canary answered 401/403/404/3xx                   | The public location is not published, or the base URL is wrong. See below.   |
   | `public_read` / `public_unreachable` | Network error or HTTP 5xx from the public base               | CDN or provider incident, DNS, TLS. Check the base URL from outside the VPC. |
   | `public_read` / `content_mismatch`   | HTTP 200 with other bytes (an error page, a CDN placeholder) | Compare with `curl`; fix the CDN origin or cache rule.                       |
   | `setup` / `check_error`              | The canaries could not be written                            | Grant object write on both buckets to the application credentials.           |
   | any / `timeout`                      | No answer within `STORAGE_PUBLIC_CHECK_TIMEOUT_SECONDS`      | Same as unreachable; raise the timeout only for a proven slow origin.        |

2. Reproduce with the operator command. It prints PASS/FAIL per step and never prints a
   credential, endpoint or provider message:

   ```bash
   pnpm --filter api storage:check          # from a checkout
   node dist/cli/storage-check.js           # from the production image
   ```

3. A 403 or 404 on the public canary means nothing publishes the `public/` namespace.
   Re-apply the provider step from [Public Files](../../storage/public-files.md#publish-the-location):
   the bucket policy, the public bucket setting, the custom domain or the CDN origin.
   In `acl` mode a 403 after a successful upload also means the server ignored the ACL:
   switch to `external`.
4. After the fix the next scheduled check clears the state; restart the process to check
   at once. Uploads of public files are not blocked by this alert, but their URLs do not
   work until the location is published.

In `api` mode the public canary is fetched from the API's own public route at
`STORAGE_PUBLIC_BASE_URL`, so the address must also be reachable **from the API process**
(a reverse proxy or load balancer in front of it counts). `public_unreachable` right after
switching to `api` usually means the base URL names an address the container cannot reach,
for example a public host name behind a firewall that blocks hairpin traffic. The check
also asks the route for the private canary; any 2xx there is a `private_exposed_base`
incident, and a 404 or 403 is correct.

The canaries sit under `public/<STORAGE_PROBE_PREFIX>/` and `<STORAGE_PROBE_PREFIX>/`.
They are tiny and fixed; if a lifecycle rule removes them, the check writes them again.

## Private exposure

`AMCoreStoragePrivateExposed` (**page**) fires when the check read its **private** canary
without any credential for five minutes. Treat it as a data exposure incident, not as a
monitoring fault.

```promql
amcore_storage_private_exposed == 1
```

1. Read the `storage_public_check_failed` event: `stage=private_exposed_api` means the
   private bucket itself answers anonymous requests through the storage API
   (a public ACL or policy on the whole bucket); `stage=private_exposed_base` means the
   public base also serves private keys because one bucket holds both namespaces and
   the published rule or domain covers more than `public/`.
2. Remove the public grant first, investigate second: restore the private bucket
   policy or ACL, or narrow the rule to the `public/` prefix, or move the public files
   to their own bucket. Confirm with an unsigned request that the private canary now
   answers 401, 403 or 404.
3. Decide what was reachable. The canary proves the path was open, not that an object
   was fetched. Review the provider's access logs for anonymous reads of private keys
   (for example `avatars/<user>/…/original`) during the exposure window, and follow your
   incident process for any real access.
4. Rotate credentials only if the incident also involved them; an anonymous read does not
   use them.
5. A provider public domain or website that is bound to the **private** bucket without
   the application's knowledge cannot be seen by this check. The
   [Public Files](../../storage/public-files.md#verify-the-setup) checklist covers it.

## Interval configuration

The [runtime settings API](../../backend/settings.md#operator-api-and-rights)
separates saved state from this API's applied state. A saved change can precede
runtime adoption. Inspect bounded `runtime_setting_applied` events for the
process role, boot identity, key, revision and interval; the storage gauge alone
is not proof of a setting revision. Readers reconcile independently every 30
seconds. A healthy 35-second target is not a partition or event-loop-pause SLA.

On `runtime_setting_refresh_failed`, check primary database connectivity, pool
pressure, schema/version integrity and migration seed. Warm readers retain their
last confirmed value; a cold unconfirmed reader uses env. Recovery is recorded
as `runtime_setting_refresh_recovered`. Settings GET can fail while existing
Overview storage observations remain available. Redis session/rate failures can
block operator access without stopping the database readers/probes.

Restore a previous interval through a new revision-checked write. Reset uses
null through the operator API, retaining the row and advancing revision on a
real change; saving 600 is an explicit override. Align deployment baselines before
reset. These controls do not trigger manual probes or acknowledge a fleet.

After restoring an older database backup, restart all API/worker processes to
clear revision-regression protection and initialize from restored state. Confirm
settings GET and each process's application events after recovery; restoring a
backup can also lose settings and audit changes made after that backup.

For deployment or binary rollback, follow the
[all-process rollout contract](../deployment.md#runtime-settings-rollout).
Pre-settings API/worker binaries ignore overrides and use env; their API/web audit
contracts reject `RUNTIME_SETTING` events. Direct rollback to those releases is
unsupported once such events exist. Reset does not remove them or make rollback
safe. Prefer forward repair; preserve settings and audit data. Settings-aware
readers also require compatible schema versions. Do not delete rows or reverse
migrations to silence a compatibility failure.
