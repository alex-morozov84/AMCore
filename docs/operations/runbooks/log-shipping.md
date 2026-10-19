# Log shipping runbooks

Covers `docs/operations/prometheus/optional/amcore-log-shipping.yml`, the optional alerts for
the [log-search reference overlay](../log-search.md). They watch the log pipeline itself (Alloy
and Loki), not the application. The application keeps running when the pipeline is down; the
risk is losing log lines after they rotate out of Docker's files
(`COMPOSE_LOG_MAX_SIZE` × `COMPOSE_LOG_MAX_FILE` per service, 20m × 5 by default).

These alerts exist only if you load the rules into a Prometheus that scrapes the overlay (see
[Alerts](../log-search.md#alerts)); the overlay ships none. Without one, run these checks by hand.

Commands below use this shorthand; run them from the repository root on the Docker host:

```sh
export COMPOSE_LOGS="docker compose -f docker-compose.yml -f docker/compose/prod.yml -f docker/compose/logs.yml"
```

## Collector down

**Symptom:** `AMCoreLogCollectorDown` is firing (Alloy is not scraped or `up` is 0).

**Likely causes, ranked:**

1. The `alloy` container stopped or is restarting.
2. Prometheus cannot reach `alloy:12345`: it is not attached to the overlay's internal `logs`
   network (Alloy publishes no host port).
3. The Alloy configuration no longer parses after an edit.

**Diagnostic steps:**

1. Check the container and its last output:

   ```sh
   $COMPOSE_LOGS ps alloy
   $COMPOSE_LOGS logs --tail 50 alloy
   ```

2. If it restarts, the log names the faulty line of `docker/log-search/alloy/config.alloy`.
3. If it runs, confirm Prometheus shares the `logs` network with it.

**Resolution:** fix the configuration or network, then `$COMPOSE_LOGS up -d alloy`. Alloy resumes
from its stored positions, so lines still inside Docker's rotation window are sent without gaps or
duplicates. Lines that rotated away while it was down are not recovered.

## Log store down

**Symptom:** `AMCoreLogStoreDown` is firing (Loki is not scraped or `up` is 0).

**Likely causes, ranked:**

1. The `loki` container stopped, was killed for memory, or cannot start because the volume is
   full or unwritable.
2. A configuration error after an edit to `docker/log-search/loki/loki.yml`.
3. Prometheus cannot reach `loki:3100` (same network cause as above).

**Diagnostic steps:**

1. Check the container, its health and its output:

   ```sh
   $COMPOSE_LOGS ps loki
   $COMPOSE_LOGS logs --tail 80 loki
   $COMPOSE_LOGS exec logs-grafana wget -q -O- http://loki:3100/ready
   ```

   The Loki image has no shell, so readiness is checked from the Grafana container.

2. `no space left on device` means [Disk low](#disk-low) is also true.

**Resolution:** fix the cause and `$COMPOSE_LOGS up -d loki`. Alloy retries with backoff while
Loki is away and sends the backlog afterwards.

## Shipping retrying

**Symptom:** `AMCoreLogShippingRetrying` is firing: Alloy has retried sending batches to Loki for 10
minutes. A healthy pipeline never retries.

**Likely causes, ranked:**

1. Loki is up but not ready (still starting, or its ingester is failing).
2. Loki refuses the batches (limits, see [Store refusing lines](#store-refusing-lines)).
3. The network between Alloy and Loki is broken.

**Diagnostic steps:**

1. `$COMPOSE_LOGS logs --tail 50 alloy` shows the send errors and their cause.
2. `$COMPOSE_LOGS exec logs-grafana wget -q -O- http://loki:3100/ready` must print `ready`.
3. If no application line reaches Loki at all, inspect the service's log options. The output must
   show `json-file` with `labels`:

   ```sh
   docker inspect <container> --format '{{ .HostConfig.LogConfig }}'
   ```

   A container created before the overlay was applied keeps its old log driver; recreate it with
   `$COMPOSE_LOGS up -d api worker web`. Alloy drops every line that carries no service label.

## Lines stop after a Docker upgrade

**Symptom:** a fresh request is not searchable in Grafana, yet Alloy and Loki are running and no alert
fires. No alert covers this case: Alloy keeps reading but may find nothing it can use.

**Likely causes, ranked:**

1. The services were recreated without the overlay's log driver, so they no longer write the labels
   Alloy needs (checked first below).
2. Docker's data root moved from `/var/lib/docker`.
3. The Docker upgrade changed the log file format, which needs a change to the Alloy configuration.

The steps below use the `$COMPOSE_LOGS` shorthand defined at the top of this page.

**Diagnostic steps:**

1. Check the containers still use the overlay's log driver (the output must show `json-file` with
   `labels`). If not, recreate them with `$COMPOSE_LOGS up -d api worker web`:

   ```sh
   docker inspect <container> --format '{{ .HostConfig.LogConfig }}'
   ```

2. Compare the raw file with the format Alloy expects, one JSON object per line with `log`, `stream`,
   `time` and, for these services, `attrs`:

   ```sh
   ID=$($COMPOSE_LOGS ps -q worker)
   docker run --rm -v /var/lib/docker/containers:/c:ro alpine tail -n 1 /c/$ID/$ID-json.log
   ```

3. Confirm the data root is still `/var/lib/docker` (`docker info --format '{{ .DockerRootDir }}'`).
4. `$COMPOSE_LOGS logs --tail 50 alloy` shows which files it tails and any parse error.

**Resolution:** if the file format changed, `docker/log-search/alloy/config.alloy` must be adapted to it;
until then the lines are available only through `docker logs`.

## Entries dropped

**Symptom:** `AMCoreLogEntriesDropped` is firing: Alloy gave up on entries after repeated send
failures.

**What it means:** those lines are not in Loki. They can still be read from Docker's files with
`docker logs` while they remain inside the rotation window.

**Diagnostic steps:** read the `reason` label of `loki_write_dropped_entries_total` in
Prometheus and the Alloy log. The usual causes are a long Loki outage ([Log store
down](#log-store-down)) and Loki refusing lines ([Store refusing lines](#store-refusing-lines)).

## Store refusing lines

**Symptom:** `AMCoreLogStoreRefusingLines` is firing; the `reason` label says why.

| Reason                        | Meaning                                                   | Action                                                               |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `rate_limited`                | Ingestion rate above `ingestion_rate_mb` / burst          | Find the noisy service in Loki; fix the logger before raising it     |
| `per_stream_rate_limit`       | One service floods above `per_stream_rate_limit`          | Same; raise only with the volume size in mind                        |
| `greater_than_max_sample_age` | Lines older than `reject_old_samples_max_age` (retention) | Expected after a very long outage; those lines are outside retention |
| `max_label_names_per_series`  | A pipeline change added too many labels                   | Revert the label change                                              |

Limits live in `docker/log-search/loki/loki.yml` under `limits_config`.

## Store flush failing

**Symptom:** `AMCoreLogStoreFlushFailing` is firing: Loki cannot write chunks to its volume.

**What it means:** Loki holds recent lines in memory and writes them to the volume in chunks. After a
failed write it retries a few times and then drops the chunk, while the collector still sees
successful pushes. Lines are being lost and Loki's memory grows until the cause is fixed.

**Diagnostic steps:**

1. `$COMPOSE_LOGS logs --tail 30 loki` shows `failed to flush` with the reason, normally
   `no space left on device` or `permission denied`.
2. For a full volume follow [Disk low](#disk-low). For `permission denied`, the volume must be
   writable by uid 10001 (Loki's user).

**Resolution:** free space or fix permissions, then watch the failures stop. Lines dropped
meanwhile are not recovered unless they are still inside Docker's rotation window; the collector
does not resend them, because Loki accepted them.

## Disk low

**Symptom:** `AMCoreLogStoreDiskLow` (below 15% free, ticket) or `AMCoreLogStoreDiskCritical`
(below 5% free, page). The figure is the filesystem of the `loki_data` volume as Alloy sees it.
On Docker Desktop and OrbStack it describes the virtual machine's disk, not the Mac's.

**Why it happens:** Loki has no size-based retention. Growth is bounded by the retention period
(`LOGS_RETENTION_PERIOD`, 168h by default) and the ingestion limits only.

**Resolution, in order:**

1. Check the store size: `docker run --rm -v <project>_loki_data:/d:ro alpine du -sh /d` (the project
   name is the Compose project, usually the checkout directory name).
2. Lower `LOGS_RETENTION_PERIOD` in `.env` and recreate Loki (`$COMPOSE_LOGS up -d loki`). The
   compactor applies it when it next runs, deletes expired data after `retention_delete_delay` (2h)
   and then on its 10-minute cycle, so space returns gradually and this is not an emergency lever.
3. Find what grew: a service that started logging heavily shows as a jump in its stream.
4. Grow the volume or move Docker's data root to a larger disk. Shrinking the retention is
   cheaper than a bigger disk when the extra history is not needed.

There is no safe manual delete inside the store. If the volume is completely full and you cannot grow
it, the last resort is to discard the whole store: `$COMPOSE_LOGS stop loki alloy`, then remove the
`loki_data` volume (`docker volume rm <project>_loki_data`), then `$COMPOSE_LOGS up -d loki alloy`.
This **deletes every stored log line**. Alloy keeps its read positions, so it does not resend lines
it already read; remove the `alloy_data` volume too if you want it to resend what Docker's files still
hold. In every other case, free space first (freeing space elsewhere on the same disk, such as unused
images, also helps), then restart Loki. Lowering the retention needs a running Loki, so it cannot help
when Loki cannot start on a completely full volume.
