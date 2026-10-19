# Search application logs

Use this guide to keep the logs of `api`, `worker` and `web` searchable for a bounded time on one
Docker host, and to find everything one request did, including the background jobs it started.
It describes an opt-in reference deployment: the application does not depend on it, and a fork can
send the same logs to a managed Loki-compatible service instead ([Managed Loki](#use-a-managed-loki-instead)).

**What you get:** a Grafana you open through an SSH tunnel, with a Loki data source holding the last
7 days (configurable) of application logs, searchable by `correlationId`, `jobId` or any field.

**What you do not get:** high availability, backups of the log store, a standalone monitoring host,
metrics dashboards or tracing. Those belong to a full production observability deployment. The
alerts for the log pipeline ship as portable rules ([Alerts](#alerts)) but no Prometheus ships with
this overlay.

```
api / worker / web  --stdout-->  Docker json-file logs  --read-only-->  Alloy  -->  Loki  -->  Grafana
                                  (size-bounded files)                 (collector)  (store)    (SSH tunnel)
```

## Before you start

- Docker Engine with the default data root `/var/lib/docker` on the host that runs Compose, and
  Compose v2.20.2 or newer, as for the base file. Rootless Docker keeps its logs elsewhere and is not
  supported. OrbStack was tested; its paths and disk figures describe the virtual machine. Docker
  Desktop uses the same layout but was not run.
- The production overlay path of [deployment](deployment.md) or the base `docker-compose.yml` stack.
- Enough disk for the retention you choose. As a measured reference, 140,000 lines of about 1.4 KB
  (7 days of a small service) took 212 MB on disk. Your lines and compression will differ; watch the
  [disk alert](#alerts) instead of trusting this figure.

## Install

1. Add these to `.env`:

   ```sh
   LOGS_GRAFANA_ADMIN_PASSWORD="<a long random password>"   # required, there is no default
   LOGS_RETENTION_PERIOD=168h                                # optional, hours; 168h = 7 days
   LOGS_GRAFANA_PORT=3002                                    # optional, published on 127.0.0.1 only
   ```

2. Apply the overlay after the files you already use. It recreates `api`, `worker` and `web`, because
   the log driver is set when a container is created:

   ```sh
   docker compose -f docker-compose.yml -f docker/compose/prod.yml -f docker/compose/logs.yml up -d
   ```

   Leave out `-f docker/compose/prod.yml` if you do not use the production overlay.
   Expected result: `loki`, `alloy` and `logs-grafana` are running, and `docker inspect` of `api`
   shows the `json-file` log driver with the `labels` option.

3. Open Grafana from your own machine through an SSH tunnel; nothing else is reachable:

   ```sh
   ssh -L 3002:127.0.0.1:3002 <user>@<docker-host>
   ```

   Then browse to `http://localhost:3002` and sign in as `admin` with the password from step 1.

4. Choose **Explore**, keep the **AMCore Loki** data source and run `{service=~"api|worker|web"}`.
   You should see recent lines of all three services.

## Find a request

Every API response carries the request's ID in `X-Correlation-Id`. Error bodies carry it as
`correlationId` and audit records as `requestId`. Send your own with `X-Request-ID` to know it in
advance; see [Observability](observability.md#structured-logs) for the accepted format. The ID is a
search aid, not proof of identity.

| You want                           | Search in Explore                                               |
| ---------------------------------- | --------------------------------------------------------------- |
| Everything one request did         | `{service=~"api\|worker\|web"} \|= "<correlationId>"`           |
| The same, matching the field only  | `{service=~"api\|worker\|web"} \| json \| correlationId="<id>"` |
| Errors and warnings in the last 1h | `{service=~"api\|worker\|web"} \| json \| level >= 40`          |
| One queued job                     | `{service=~"api\|worker"} \|= "<jobId>"`                        |
| One notification delivery          | `{service="worker"} \|= "<deliveryId>"`                         |

Prefer the first form: it is the fastest. On the reference data set (140,000 lines over 7 days) it
took about 0.2 s and the `json` form about 0.6 s.

**What you will see for a request that queued an email:** the API lines (request, queue, the
`job.enqueued` line with `jobId`, `incarnation` and `duplicate`) and one worker line `Job finished`
with the same `correlationId`, plus `workId`, `jobId` and `outcome`. A failed run logs
`Job did not finish` with a safe `reason`. Grafana adds a link to every `correlationId` it finds in a line; it searches for the same ID.

Limits of the link between a request and its jobs:

- Only jobs started during a request carry its ID. Scheduled work and every wake job
  (notifications, AI runs) do not; search a notification by `deliveryId`. AI-run worker code logs
  few lines of its own; a few carry `runId`.
- A duplicate add keeps the first request's ID. Its `job.enqueued` line with `duplicate: true`
  links the later request to the same `jobId`.
- A manual retry from the Operations Console runs under the original request's ID. The command's
  audit record holds the operator's own `requestId`.

## Retention, disk and sizing

- Retention is `LOGS_RETENTION_PERIOD` (default 168h). Loki deletes expired data after the compactor
  runs and a two-hour delay, so space returns gradually. Lines older than the period are refused
  when sent, which matters only after a very long collector outage.
- Loki has no size-based retention. Growth is bounded by the retention period and the ingestion
  limits in `docker/log-search/loki/loki.yml` (4 MB/s, 3 MB/s per stream). Size the volume for your
  traffic and keep the [disk alert](#alerts).
- Docker's own files stay bounded by `COMPOSE_LOG_MAX_SIZE` and `COMPOSE_LOG_MAX_FILE`
  (20m × 5 per service by default). They are your safety net while the pipeline is down.
- Measured on an idle Compose stack: Loki about 80 MiB, Alloy about 50 MiB, Grafana about 210 MiB.

## What fails, and what is lost

The application never waits for the pipeline: it writes to stdout.

| Event                        | Effect on the application | Effect on logs                                                                                     |
| ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| Loki stops                   | None                      | Alloy retries; lines still in Docker's files are delivered when Loki returns                       |
| Alloy stops                  | None                      | Alloy resumes from its stored position; nothing is lost or repeated                                |
| Outage longer than the files | None                      | Lines that rotated out of Docker's files meanwhile are lost                                        |
| Volume full                  | None                      | Loki fails to flush, retries, then drops chunks; see [Disk low](runbooks/log-shipping.md#disk-low) |
| A container logs over 16 KiB | None                      | Docker splits the line; fragments are stored and only the first holds the `correlationId`          |

Tested: Loki stopped and started again, and Alloy stopped and started again, while requests kept
arriving (every line arrived once); about 60,000 numbered lines across ten rotations of the Docker
file (none lost, none repeated); a full size-bounded volume (Loki errors, both disk alerts fired).
A container that rotates its first file before Alloy discovers it, within about ten seconds of its
creation, loses the rotated part; this needs a log volume far above normal start-up output.

## Security

Treat Alloy as a secret-visible, host-privileged component.

- It reads Docker's log files for **every** container on the host, including each container's
  `config.v2.json`, which holds its environment variables and therefore secrets. It runs as root
  because those files are root-owned. A line is sent only if it carries the Compose service label
  that the overlay sets on `api`, `worker` and `web`; everything else, such as Postgres and Redis,
  is dropped inside Alloy.
- It has a read-only root filesystem, no capabilities, `no-new-privileges`, no published port, no
  Docker socket and a network that cannot reach anything but Loki. Keep it that way: do not attach it
  to another network and do not mount more host paths.
- Loki has no authentication. It publishes no port and only Alloy and the overlay's Grafana share its
  network. Do not publish it. Grafana is the only way in: it needs the admin password and listens on
  `127.0.0.1` only.
- Docker's documentation says the files of its logging drivers are meant for the Docker daemon and
  that external tools should avoid them. This reference reads them read-only because the alternative,
  the Docker API, needs a root-equivalent socket in a container. Rotation was tested (see above). No
  alert covers a Docker upgrade that changes the file format, so search for a fresh request after every
  Docker upgrade.
- Logs are only as clean as what the services write. Recipients are redacted and subjects are never
  logged, and a scan of the stored lines found no email address, password, token or secret from the
  test environment. Review any new log line before you add it.

## Alerts

`docs/operations/prometheus/optional/amcore-log-shipping.yml` holds eight rules: collector down, store
down, shipping retrying, entries dropped, store refusing lines, flush failing, disk low (15%) and disk
critical (5%). Their runbooks are in [log-shipping](runbooks/log-shipping.md).

This overlay does not ship a Prometheus. Load the rules in your own Prometheus that can reach the
overlay's `logs` network, and copy the scrape jobs from `docker/log-search/prometheus/scrape-logs.yml`.
Until you do, nobody is notified; check the pipeline by hand after changes.

## Use a managed Loki instead

Skip `loki` and `logs-grafana`, point Alloy at your endpoint by changing the `url` of `loki.write` in
`docker/log-search/alloy/config.alloy` and adding the endpoint's authentication block, and give Alloy
network access to that endpoint. This variant was not run; check it against Alloy's `loki.write`
reference and keep the secret-visible invariant above.

## Upgrade the pinned images

Loki, Alloy and Grafana are pinned by digest in `docker/compose/logs.yml`; Loki and Alloy are pinned a
second time in `.github/workflows/ci.yml`, and the observability contract checks that they match. To
upgrade, change both, then check `loki -verify-config` and `alloy validate` (CI runs both), the metric
names used by the alert rules, and a search for a known request.

## Turn it off

```sh
docker compose -f docker-compose.yml -f docker/compose/prod.yml up -d --remove-orphans
```

Without the overlay file this recreates `api`, `worker` and `web` with the production log driver and
removes `loki`, `alloy` and `logs-grafana`. Their volumes (`loki_data`, `alloy_data`,
`logs_grafana_data`, prefixed with the Compose project name) stay until you remove them with
`docker volume rm`; do that only when you no longer need the stored logs.
