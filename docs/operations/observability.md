# Observability

AMCore exposes Prometheus metrics from the API process. Logs remain structured
Pino JSON with `correlationId`; metrics are the low-cardinality time-series
surface for latency, error rate, and runtime health trends.

## Metrics Endpoint

Real bootstrap sets the global prefix, so the scrape path is:

```text
GET /api/v1/metrics
```

The e2e test app does not set the global prefix, so tests scrape `/metrics`.

`METRICS_ENABLED=true` by default. When disabled, the route returns `404`.

## Production Exposure

Do not expose `/api/v1/metrics` to the public internet without protection.

Recommended production patterns:

- scrape it from a private pod/service network;
- block it at public ingress; or
- set `METRICS_AUTH_TOKEN` and configure Prometheus to send a bearer token.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: amcore-api
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['api:5002']
    authorization:
      type: Bearer
      credentials: '${METRICS_AUTH_TOKEN}'
```

## Current Metrics

AMCore currently exports:

- default `prom-client` Node.js/process metrics (`process_*`, `nodejs_*`);
- `amcore_http_requests_total{method,route,status_code,role}`;
- `amcore_http_request_duration_seconds{method,route,status_code,role}`;
- `amcore_http_requests_in_flight{method,route,role}`;
- `amcore_metrics_collector_errors_total{collector}`;
- `amcore_db_pool_connections{state,role}`, where
  `state=total|idle|waiting`;
- `amcore_db_slow_queries_total{role}`;
- `amcore_redis_client_events_total{client,event,role}`;
- `amcore_queue_jobs{queue,state,role}`;
- `amcore_queue_events_total{queue,event,role}`.

HTTP metrics are captured with middleware and `res.on('finish')`, so guard
rejections and unmatched routes are counted. `/api/v1/metrics` is excluded from
its own HTTP metrics and from request logs. Health routes are excluded from logs
but included in HTTP metrics.

DB pool values are collected at scrape time from the process-local PostgreSQL
pool. Slow-query metrics intentionally do not include query text or model names.

Redis labels are bounded:

- `client=shared|queue_producer|queue_worker|throttler`;
- `event=error|reconnecting|degraded`.

The shared node-redis and BullMQ clients report only verified events. The
throttler reports every Redis fallback as `client=throttler,event=degraded`; its
log remains debounced independently.

Queue depth uses these bounded states:

```text
waiting active delayed completed failed paused prioritized waiting_children
```

It is exported only from worker-capable module graphs:

- `PROCESS_ROLE=worker`: exported;
- `PROCESS_ROLE=all`: exported;
- `PROCESS_ROLE=web`: absent.

Queue depth is shared Redis state, not a per-process value. Never sum it across
replicas. Use non-additive aggregation:

```promql
max by(queue, state) (amcore_queue_jobs)
```

Queue events are bounded to `job_added`, `redis_error`,
`redis_reconnecting`, `worker_error`, and `dead_letter`. Job IDs and arbitrary
job names are never metric labels.

Future Arc 4 stages add cache, storage, media, email-domain metrics, and optional
OpenTelemetry tracing.

## Label Rules

Labels must stay bounded and non-sensitive.

Allowed examples:

- process role: `web`, `worker`, `all`;
- normalized HTTP route templates such as `/organizations/:id`;
- status code;
- bounded queue/cache/storage/email/media operation names.

Forbidden examples:

- raw URLs, query strings, or route regex internals;
- user, organization, session, invite, API key, or job IDs;
- email addresses, phone numbers, IP addresses, user agents;
- object keys, buckets, signed URLs, Redis keys;
- tokens, token hashes, API key hashes, password fields;
- prompt text or provider payloads for future AI features.

If a safe route template cannot be derived, AMCore uses a bounded fallback such
as `unknown` instead of the raw path.

## Web And Worker Roles

`PROCESS_ROLE=web`, `worker`, and `all` all expose metrics. The worker process
has no business API routes and no Bull Board, but it does expose health and
metrics so Kubernetes can probe it and Prometheus can scrape it.
