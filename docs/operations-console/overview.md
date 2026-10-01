# Overview

[Operations Console](README.md) → Overview

Overview answers whether the responding API is ready, whether files work, and
whether its local resources need attention. It describes one instance, without
fleet totals, historical charts or an automatic page refresh.

If a card reports a problem, start with the named dependency or file-check
failure. Use the [file storage runbook](../operations/runbooks/storage.md) for
file failures, and the [operations guide](../operations/README.md)
for database, Redis and resource problems. Refresh after remediation to see a
new snapshot; a healthy card does not certify other instances.

## Snapshot and readiness

One top timestamp is completion of the whole API snapshot, displayed in the
selected Console time zone. Readiness and each resource still have independent
measurement timestamps in the API contract: the numbers need not equal those
that caused a readiness check to fail. Choose **Refresh** for a new snapshot.
The fetch uses `no-store` and the existing five-second whole-request deadline;
this deadline does not cancel work already running in the API.

Readiness checks identify the affected dependency: database, Redis, memory or
disk, plus file storage if its separate readiness option is enabled. Expected
not-ready/degraded results are observation data, not a failed Overview request.
Resource values do not override the readiness verdict.
If Overview says **Temporarily unavailable**, use **Retry**. If it persists,
inspect API and web logs. Other request errors use the normal Console error
page. Runtime mode and manually supplied labels do not attest whether the
deployment is production; no inferred environment badge
is displayed.

## Resources

| Card                 | Why to look and what it means                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connections | Open/idle connections and waiting requests in this API's pool. A persistent queue can indicate saturation; waiting above the configured threshold makes the API not ready. This is not database-wide utilization or proof of connectivity. |
| JavaScript memory    | Memory used by JavaScript in this API process. Persistent growth may indicate a leak; exceeding the heap threshold fails readiness. It excludes native/process/container/VPS memory.                                                  |
| API disk space       | Capacity and available bytes on the filesystem containing `/` inside the API. Unavailable share includes reserved blocks. It can share backing storage with the VPS, but does not measure S3 or a separate uploads volume.            |

Bytes use decimal MB/GB/TB (1 MB = 1,000,000 bytes) with appropriate scale.
Thresholds are configured comparisons, not capacity guarantees. Failed secondary
reads make only the affected card unavailable, never zero. Help is available by
keyboard focus as well as pointer hover; the visible description gives basic scope.

## File storage

File storage is actively checked independently of API readiness: a small isolated
write/read/delete transaction runs periodically on the configured local or
S3-compatible driver. The default is **every 10 minutes**, configured through
`STORAGE_PROBE_INTERVAL_SECONDS`. The File storage card displays the actual interval
and explains that each API/worker instance consumes S3 requests independently;
provider charges may apply. S3 displays a prominent request-cost notice: increasing
the interval reduces request volume but delays failure detection. Local storage
does not show a provider request-charge notice. Overview only reads its cached result. **Working** requires
matching bytes and successful cleanup. **Check failed**, **Not checked yet** and
**Result is stale** are distinct. The card shows the last result timestamp and
the next scheduled check in the selected Console time zone. These are storage
events, separate from the API snapshot time. During active I/O, the next check
waits for completion rather than promising an overlapping transaction. Refresh
to see a later result. A storage failure can coexist with a ready API.
403 indicates an access failure, not proof that S3 is down.

This checks current operations, not backup integrity, persistence after container
recreation, public URL delivery or total S3 capacity. Worker/other-instance checks
are available through monitoring, not this instance's screen. A tested alert can
report a persistent failure; a downstream must configure a notification receiver
once. Leaving this page open does not itself send notifications. See
[storage configuration](../storage/configuration.md#active-file-monitoring-and-readiness)
and [runbook](../operations/runbooks/storage.md).

## Build details

The collapsed details identify builds when diagnosing an incomplete rollout or
comparing environments. API build automatically records product version and an
artifact fingerprint. CI records the source commit when available; uncommitted
local source is not falsely labelled with an exact commit. A watch-mode API may
have no built-artifact identity. No value needs hand entry on every deployment.
These values are not production attestation or a full image digest.

The web card identifies the build of the **responding web server**: its ID is
passed by the server rendering these details. It does not necessarily identify
JavaScript already loaded in the open tab. When reporting a rollout problem,
include this value to identify the server build that supplied the details.

Open tabs use web build IDs separately to detect updates and reload. In browser
DevTools, `document.documentElement.dataset.dplId` identifies the current
document, while `/api/deployment-version` reports the responding web server's
build. These diagnostic sources have different scopes; the Overview card does
not compare them or establish which JavaScript is loaded in a tab.
Neither random web ID nor API fingerprint alone identifies source code: use the available commit or
the corresponding saved build artifact (`dist/build-identity.json` for API). See [deployment](../operations/deployment.md#build-identity)
and [resource settings](configuration.md#overview-metadata-and-resource-settings).
