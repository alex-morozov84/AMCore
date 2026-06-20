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
- `amcore_queue_events_total{queue,event,role}`;
- `amcore_cache_operations_total{cache,result,role}`;
- `amcore_storage_operations_total{driver,operation,result,role}`;
- `amcore_storage_operation_duration_seconds{driver,operation,result,role}`;
- `amcore_media_operations_total{preset,operation,result,role}`;
- `amcore_media_operation_duration_seconds{preset,operation,result,role}`;
- `amcore_email_operations_total{template,operation,mode,result,retryable,role}`;
- `amcore_email_operation_duration_seconds{template,operation,mode,result,role}`;
- `amcore_email_dead_letters_total{template,unrecoverable,role}`.

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

Cache metrics use `cache=user|permissions` and
`result=hit|negative_hit|miss|db_fallback|corrupt`. Only the explicit user
negative-cache envelope emits `negative_hit`; a cached permissions `[]` is a
normal `hit`. A corrupt entry emits both `corrupt` and `miss` because it is
deleted and handled as a miss. `db_fallback` counts actual DB loads after cache
miss or lock contention.

Cache counters are recorded per Redis read, not per request: under cache-stampede
lock contention a single lookup may re-read the cache several times, so these
counters can exceed one increment per request. Compute hit ratios from the
counters themselves (for example `hit / (hit + miss)`) rather than against request
counts.

Storage metrics are emitted by the `StorageService` facade, so all drivers have
the same surface:

- `driver=s3|local|memory`;
- `result=success|error`;
- bounded operations: `upload`, `download`, `download_stream`, `get_metadata`,
  `delete`, `delete_many`, `exists`, `list`, `copy`, `move`,
  `signed_download_url`, and `signed_upload_url`.

The synchronous `getPublicUrl()` constructor is intentionally excluded because
it performs no I/O. Object keys, buckets, endpoints, and URLs are never labels.

Media metrics currently use `preset=avatar`,
`operation=process|delete_derivatives`, and `result=success|error`. They measure
the complete media operation, while the nested storage calls remain visible in
the storage metrics. Source/derivative keys, owner IDs, dimensions, and error
messages are not labels.

Email metrics keep phase and delivery semantics separate:

- `operation=dispatch|render|send|process`;
- `mode=queued|direct|worker`;
- `result=success|error|discarded`;
- `retryable=true|false|unknown`;
- `template=welcome|password-reset|email-verification|org-invite|notification|unknown`.

`dispatch/queued` measures enqueueing, `render` and `send` measure their own
phases, and `process/worker` measures the complete BullMQ attempt. Secret-bearing
legacy queue jobs and unknown job types are `discarded`, not silently counted as
success. Terminal failures also increment
`amcore_email_dead_letters_total{template,unrecoverable}`. Recipient addresses,
provider IDs, job IDs, payloads, and error messages are never labels.

Realtime notification (SSE) metrics are bounded and carry no user/IP/event IDs:

- `amcore_notification_realtime_connections{role}` — gauge of currently-open SSE
  streams on the process;
- `amcore_notification_realtime_publish_total{outcome,role}` —
  `outcome=published|failed|dropped` (`dropped` = the in-flight publish cap was hit);
- `amcore_notification_realtime_events_total{event,role}` —
  `event=received|routed|no_local_target|invalid_envelope|rejected_global|rejected_user|slow_close|startup_failure`.

`rejected_global` (503) and `rejected_user` (429) split the admission rejections;
`slow_close` counts slow consumers disconnected on write-buffer overflow;
`startup_failure` counts a stream that failed to start after admission (the
response is already committed, so it is torn down quietly rather than erroring).
The dedicated Pub/Sub subscriber connection is classified distinctly in the Redis
client-event metric (e.g. `notif-subscriber`).

The remaining Arc 4 stage is optional OpenTelemetry tracing.

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
