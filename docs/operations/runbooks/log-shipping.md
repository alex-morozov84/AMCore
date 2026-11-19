# Log shipping runbooks

Covers `docs/operations/prometheus/optional/amcore-log-shipping.yml`, the optional alerts for
the [log-search reference overlay](../log-search.md). They watch the log pipeline itself (Alloy
and Loki), not the application. The application keeps running when the pipeline is down; the
risk is losing log lines after they rotate out of Docker's files
(`COMPOSE_LOG_MAX_SIZE` × `COMPOSE_LOG_MAX_FILE` per service, 20m × 5 by default).

These alerts exist only if you load the rules into a Prometheus that scrapes the overlay (see
[Alerts](../log-search.md#alerts)); the overlay ships none. Without one, run these checks by hand.

Run the Compose commands from the repository root on the Docker host. Load
the running deployment's project name, environment file, profiles and complete
`COMPOSE_FILE` list, including the logs overlay. See [install](../log-search.md#install).

## Collector down

**Symptom:** `AMCoreLogCollectorDown` is firing (Alloy is not scraped or `up` is 0).

**Likely causes, ranked:**

1. The `alloy` container stopped or is restarting.
2. Prometheus cannot reach `alloy:12345`: it is not attached to the overlay's internal `logs`
   network (Alloy publishes no host port). Attaching it lets that Prometheus read all stored
   logs from Loki ([Alerts](../log-search.md#alerts)).
3. The Alloy configuration no longer parses after an edit.

**Diagnostic steps:**

1. Check the container and its last output:

   ```sh
   docker compose ps alloy
   docker compose logs --tail 50 alloy
   ```

2. If it restarts, the log names the faulty line of `docker/log-search/alloy/config.alloy`.
3. If it runs, confirm Prometheus shares the network: `docker network inspect <project>_logs` must
   list it (how to attach: [Alerts](../log-search.md#alerts)). Attach only a Prometheus you
   control, because it can read all logs there.

**Resolution:** fix the configuration or network, then `docker compose up -d alloy`. Alloy resumes
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
   docker compose ps loki
   docker compose logs --tail 80 loki
   docker compose exec logs-grafana wget -q -O- http://loki:3100/ready
   ```

   The Loki image has no shell, so readiness is checked from the Grafana container.

2. `no space left on device` means [Disk low](#disk-low) is also true.

**Resolution:** fix the cause and `docker compose up -d loki`. Alloy retries with backoff while
Loki is away and sends the backlog afterwards.

## Shipping retrying

**Symptom:** `AMCoreLogShippingRetrying` is firing: Alloy has retried sending batches to Loki for 10
minutes. A healthy pipeline never retries.

**Likely causes, ranked:**

1. Loki is up but not ready (still starting, or its ingester is failing).
2. Loki refuses the batches (limits, see [Store refusing lines](#store-refusing-lines)).
3. The network between Alloy and Loki is broken.

**Diagnostic steps:**

1. `docker compose logs --tail 50 alloy` shows the send errors and their cause.
2. `docker compose exec logs-grafana wget -q -O- http://loki:3100/ready` must print `ready`.
3. If no application line reaches Loki at all, inspect the service's log options. The output must
   show `json-file` with `labels`:

   ```sh
   docker inspect <container> --format '{{ .HostConfig.LogConfig }}'
   ```

   A container created before the overlay was applied keeps its old log driver; [recreate the application containers](../log-search.md#recreate-the-application-containers) using the overlay. Alloy drops every line that carries no service label.

## Lines stop after a Docker upgrade

**Symptom:** a fresh request is not searchable in Grafana, yet Alloy and Loki are running and no alert
fires. No alert covers this case: Alloy keeps reading but may find nothing it can use.

**Likely causes, ranked:**

1. The services were recreated without the overlay's log driver, so they no longer write the labels
   Alloy needs (checked first below).
2. Docker's data root moved from `/var/lib/docker`.
3. The Docker upgrade changed the log file format, which needs a change to the Alloy configuration.

**Diagnostic steps:**

1. Check the containers still use the overlay's log driver (the output must show `json-file` with
   `labels`). If not, [recreate the application containers](../log-search.md#recreate-the-application-containers):

   ```sh
   docker inspect <container> --format '{{ .HostConfig.LogConfig }}'
   ```

2. Compare the raw file with the format Alloy expects, one JSON object per line with `log`, `stream`,
   `time` and, for these services, `attrs`:

   ```sh
   ID=$(docker compose ps -q worker)
   docker run --rm -v /var/lib/docker/containers:/c:ro alpine tail -n 1 /c/$ID/$ID-json.log
   ```

3. Confirm the data root is still `/var/lib/docker` (`docker info --format '{{ .DockerRootDir }}'`).
4. `docker compose logs --tail 50 alloy` shows which files it tails and any parse error.

**Resolution:** if the file format changed, `docker/log-search/alloy/config.alloy` must be adapted to it;
until then the lines are available only through `docker logs`.

## Entries dropped

**Symptom:** `AMCoreLogEntriesDropped` is firing: Alloy gave up on entries after repeated send
failures.

**What it means:** those lines are not in Loki. They can still be read from Docker's files with
`docker logs` while they remain inside the rotation window.

**Diagnostic steps:** read the `reason` label of `loki_write_dropped_entries_total` in
Prometheus, or without one with
`docker compose exec logs-grafana wget -q -O- http://alloy:12345/metrics`, and the Alloy log. The usual causes are a long Loki outage ([Log store
down](#log-store-down)) and Loki refusing lines ([Store refusing lines](#store-refusing-lines)).

## Store refusing lines

**Symptom:** `AMCoreLogStoreRefusingLines` is firing; the `reason` label says why.

| Reason                        | Meaning                                                   | Action                                                               |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `rate_limited`                | Ingestion rate above `ingestion_rate_mb` / burst          | Find the noisy service in Loki; fix the logger before raising it     |
| `per_stream_rate_limit`       | One service floods above `per_stream_rate_limit`          | Same; raise only with the volume size in mind                        |
| `greater_than_max_sample_age` | Lines older than `reject_old_samples_max_age` (retention) | Expected after a very long outage; those lines are outside retention |
| `max_label_names_per_series`  | A pipeline change added too many labels                   | Revert the label change                                              |
| `stream_limit`                | More than `max_global_streams_per_user` (1000) streams    | Find the label that grew (see Streams below); revert the pipeline    |

Streams: each distinct set of labels is one stream. The overlay's labels are `service`,
`compose_project` and `stream` (plus the `service_name` that Loki adds from `service`), so the
count stays small. A pipeline change that adds a label with many values, such as the container
log path or an ID, multiplies the streams.

Limits live in `docker/log-search/loki/loki.yml` under `limits_config`.

## Store flush failing

**Symptom:** `AMCoreLogStoreFlushFailing` is firing: Loki cannot write chunks to its volume.

**What it means:** Loki holds recent lines in memory and writes them to the volume in chunks. After a
failed write it retries a few times and then drops the chunk, while the collector still sees
successful pushes. Lines are being lost and Loki's memory grows until the cause is fixed.

**Diagnostic steps:**

1. `docker compose logs --tail 30 loki` shows `failed to flush` with the reason, normally
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

1. Identify the existing `loki_data` volume from the Loki container's mount.
   Set `LOKI_VOLUME` to its exact name and verify its project label. Then check
   the size:

   ```sh
   docker volume inspect "$LOKI_VOLUME" >/dev/null &&
   docker run --rm -v "$LOKI_VOLUME:/d:ro" alpine du -sh /d
   ```

2. Lower `LOGS_RETENTION_PERIOD` in `.env` and recreate Loki (`docker compose up -d loki`). The
   compactor applies it when it next runs, deletes expired data after `retention_delete_delay` (2h)
   and then on its 10-minute cycle, so space returns gradually and this is not an emergency lever.
3. Find what grew: a service that started logging heavily shows as a jump in its stream.
4. Grow the volume or move Docker's data root to a larger disk. Shrinking the retention is
   cheaper than a bigger disk when the extra history is not needed.

There is no safe manual delete inside the store. If the volume is completely full and you cannot grow
it, the last resort is to discard the whole store. This deletes every stored
log line. Confirm the loss and verify the volume identity before proceeding.
With the saved Compose selection and `LOKI_VOLUME` from step 1:

```sh
docker compose stop alloy loki &&
docker compose rm -f alloy loki &&
docker volume rm "$LOKI_VOLUME" &&
docker compose up -d loki alloy
```

Stop on error. If another container still holds the volume, verify its owner
before acting. Alloy keeps its read positions in a separate volume. Keep that
volume unless you deliberately plan to replay surviving Docker logs.
In every other case, free space first (freeing space elsewhere on the same disk, such as unused
images, also helps), then restart Loki. Lowering the retention needs a running Loki, so it cannot help
when Loki cannot start on a completely full volume.
