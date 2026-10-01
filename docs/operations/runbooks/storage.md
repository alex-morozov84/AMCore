# File storage

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
container recreation, public/CDN URLs or capacity of S3.
