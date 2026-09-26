# GeoIP Setup

AMCore optionally resolves an approximate city/country for a session's stored
IP address, shown on the product's own Settings → Sessions page (see
[Sessions § Listing active sessions](../auth/sessions.md#listing-active-sessions)).

The optional Console's user Sessions panel also shows this information; see
[Operations Console → Users § Manage sessions](../operations-console/users.md#manage-sessions).
It is enabled by default and always degrades gracefully: auth, session
listing, and session revocation all work whether or not a database is
configured, loaded, or current.

## How it works

- **Provider:** [DB-IP City Lite](https://db-ip.com/db/lite.php) — a free,
  monthly-updated `.mmdb` file in the standard MaxMind DB binary format,
  licensed CC BY 4.0 (a visible attribution link to db-ip.com is required
  wherever a resolved location is shown — each shipped session view already
  includes it).
- **Reader:** the [`maxmind`](https://www.npmjs.com/package/maxmind) npm
  package (MIT), one long-lived reader per API/worker process — never opened
  per request. Every enabled process checks file identity/size/mtime every
  30 seconds, recovering after missing boot or atomic replacement without
  a restart; an invalid replacement retains the last valid reader. Failed
  reads retry on later checks even if the file has not changed; warnings
  are emitted once per failed file generation.
- **Updater:** a daily scheduled check (`GeoIpUpdateService`), using the same
  `@Cron` + Redis-lock singleton pattern as the existing nightly session
  cleanup job — only the lock-winner replica actually downloads. It only
  runs where the scheduler is active (the `worker`/`all` process roles, never
  `web`; see [Deployment & migrations](deployment.md) for the process-role
  split). A worker with no valid database yet also makes one nonblocking
  bootstrap attempt on startup, through the same guarded path.
- **Skip logic:** the updater compares the loaded database's own embedded
  `build_epoch` metadata against the current UTC month and skips the ~120 MB
  download entirely when already current.
- **Bounds:** downloads have a five-minute deadline, a 200 MiB compressed
  cap and a 400 MiB decompressed cap. Candidate MMDB metadata must match
  the requested UTC month before replacement. The daily check runs at
  03:00 UTC.
- **Atomicity:** the updater downloads and validates into a temporary file in
  the same directory as the live database, then `rename()`s it into place —
  a reader never observes a partially-written file. A failed download or a
  file that fails validation leaves the last good database in place.

## Configuration

| Variable        | Default                           | Purpose                                                                                                                                   |
| --------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GEOIP_ENABLED` | `true`                            | Set `false` to disable GeoIP entirely — every session's `location` is then always `null`.                                                 |
| `GEOIP_DB_PATH` | `/data/geoip/dbip-city-lite.mmdb` | Where the API reads the database and the updater writes it. Must resolve to the same shared volume from every process role that reads it. |

Both are documented (and validated as copyable) in `.env.example`.

## Storage and topology

The database lives on a shared volume, read-only from every API process and
read-write from the singleton updater. The bundled `docker-compose.yml`
mounts one named volume into both the `api` and `worker` services — this
covers the default **single-host** Compose deployment only. A multi-host or
horizontally-scaled deployment is responsible for its own shared-file
distribution (a network filesystem, an object-storage sync step, or a
per-host updater with local storage); AMCore does not add new default
infrastructure for that case.

Production data is fetched at runtime by the updater and never bundled into
the web build. A small synthetic MMDB under API test fixtures is used only
for offline reader tests.

## Missing, corrupt, or stale database

- **Missing** (not configured, or before the updater's first successful
  run): every session's `location` resolves to `null`. No blocking startup
  dependency.
- **Corrupt:** the updater's own validation step (opening the downloaded
  file with the real reader) rejects it before the atomic swap, so a corrupt
  download never reaches readers.
- **Stale** (no successful update in over 45 days): the last good database
  keeps serving approximate labels rather than being hidden. Accuracy of stale data is not guaranteed. A bounded
  operator-facing warning is logged (`geoip.database_stale`); there is no
  separate "stale" indicator shown to a session viewer.

## Privacy and scope

- Only `city` and `countryCode` are ever exposed — no coordinates, ISP,
  autonomous-system, or other MMDB fields.
- Private, reserved, loopback, link-local, and documentation/multicast addresses are
  filtered out before a lookup is attempted (mapped addresses are normalized
  to their embedded IPv4 form first, so a legitimate public address in that
  shape is not wrongly excluded — see RFC 4291 §2.5.5.2).
- The location reflects the stored IP at lookup time, not a historical
  snapshot of where a session actually originated.
- `city` is resolved server-side in the caller's negotiated locale (English
  fallback); `countryCode` is a narrow ISO 3166-1 alpha-2 code the client
  localizes itself.

## First-run bootstrap and manual update

A worker/all process with no valid reader makes one nonblocking bootstrap
attempt using the same Redis singleton lock as its daily check. API web-role
processes only read; they never download. To retry immediately, run the
compiled command in the writable updater container:

```bash
docker compose -f docker-compose.yml exec worker node dist/cli/geoip-update.js
```

The command creates no HTTP listener, scheduler or queue consumers, closes
its application context, and exits nonzero when enabled data is still not
current (including download/lock failures). It shares the updater's lock and
skips downloading an already-current edition. There is no admin HTTP endpoint.

## Capturing visitor IP through the BFF

A default localhost setup stores a local/private peer address, so location
is null. For a deployment behind a sanitizing edge, configure both halves
of the [BFF client-IP relay](deployment.md#bff-client-ip-relay-appsweb--appsapi--a-separate-contract-from-trust_proxy):
WEB_TRUSTED_CLIENT_IP_HEADER on web and explicit TRUSTED_WEB_PEERS on API.
Session capture validates the actual socket peer and the internal IP claim;
disabled/untrusted/malformed claims fall back to req.ip/socket metadata.
Registration, password login, OAuth login callbacks and refresh generations
capture current request metadata. Password-login limiter addresses, global
req.ip/TRUST_PROXY, audit, invite and step-up consumers remain unchanged.
UA and location are descriptive data, never proof of a device or identity.
No reliable backfill of historical Node UA/internal Docker IP is possible.

## Diagnose unavailable locations

| Symptom                                            | Check and action                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every location is unavailable in local development | Private peer IPs are expected without a sanitizing edge. Configure the verified BFF relay for a deployed visitor-IP signal; do not enable trust on a directly reachable web server.        |
| Public stored IPs still have no location           | Check `GEOIP_ENABLED`, database path, and the shared volume in both API and worker. Look for `geoip.reader_loaded` or `geoip.reader_load_failed`; the API reader retries every 30 seconds. |
| Worker cannot publish data                         | Check write permissions for the non-root worker user and the writable worker mount. Keep the API mount read-only. Retry with the manual command above after correction.                    |
| Downloads fail or data stays old                   | Inspect `geoip.update_failed` and `schedule.geoip_update_*` events for provider, deadline, size, validation or lock failures. Auth/revoke remain available; the next daily check retries.  |
| Only some API replicas show location               | Verify shared-file distribution and reader-load events on each replica. A single-host named volume does not distribute files between hosts.                                                |

No location can be promised for every public IP. VPNs, proxies, provider coverage
and edition age can all affect the result; an unavailable match is not evidence
of an invalid session. Historical addresses are not reconstructed.
