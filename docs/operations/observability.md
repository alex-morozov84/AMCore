# Observability

AMCore exposes Prometheus metrics from the API process. Logs are structured Pino
JSON with a `correlationId`; metrics are the low-cardinality time-series surface
for latency, error rate, and runtime health.

## Structured Logs

Application logs are structured Pino JSON in production and carry a
`correlationId` on every record. The value is read from `X-Request-ID` /
`X-Correlation-ID` when present, otherwise AMCore generates one per request.

HTTP request logs include bounded request metadata — method, route, status, user
id when authenticated, user agent, and an **anonymized client IP** (IPv4 host
octet zeroed; IPv6 reduced to its network prefix). Health routes are excluded
from request logs to reduce noise.

Sensitive data is redacted before logs leave the process: passwords, password
hashes, refresh/access/OAuth tokens, API keys, cookies, authorization headers,
token-bearing action URLs, AI operator reasons, provider bodies, and other known
secret-bearing fields. **New code must not log** raw request bodies, rendered
email bodies, object keys, prompt/provider payloads, or free-form user content
unless a feature-specific public doc explicitly allows that field.

## Metrics Endpoint

The scrape path is `GET /api/v1/metrics` (the e2e test app has no global prefix,
so tests scrape `/metrics`). `METRICS_ENABLED=true` by default; when disabled the
route returns `404`.

## Production Exposure

Do not expose `/api/v1/metrics` to the public internet without protection.
Recommended patterns: scrape it from a private pod/service network, block it at
public ingress, or set `METRICS_AUTH_TOKEN` and have Prometheus send a bearer
token.

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

## Metric Families

Every metric is `amcore_`-prefixed (plus default `prom-client` `process_*` /
`nodejs_*`) and carries only bounded labels. `role` is the emitting process role
(`web|worker|all`). This is the family reference; the [label rules](#label-rules)
are the hard contract every label must satisfy.

**HTTP & runtime**

- `http_requests_total{method,route,status_code,role}`,
  `http_request_duration_seconds{…}`, `http_requests_in_flight{method,route,role}`
  — captured on `res.on('finish')`, so guard rejections and unmatched routes are
  counted. `/api/v1/metrics` is excluded from its own HTTP metrics.
- `metrics_collector_errors_total{collector}`.
- `db_pool_connections{state,role}` (`state=total|idle|waiting`),
  `db_slow_queries_total{role}` — collected from the process-local pool; no query
  text or model names.
- `redis_client_events_total{client,event,role}` —
  `client=shared|queue_producer|queue_worker|throttler` (SSE Pub/Sub subscribers
  appear distinctly, e.g. `notif-subscriber`, `ai-run-subscriber`);
  `event=error|reconnecting|degraded`.

**Queues** (exported by `worker`/`all` only — absent on `web`)

- `queue_jobs{queue,state,role}` —
  `state=waiting|active|delayed|completed|failed|paused|prioritized|waiting_children`.
- `queue_events_total{queue,event,role}` —
  `event=job_added|redis_error|redis_reconnecting|worker_error|dead_letter`. Job
  IDs and job names are never labels.

**Cache**

- `cache_operations_total{cache,result,role}` — `cache=user|permissions`,
  `result=hit|negative_hit|miss|db_fallback|corrupt`.

**Storage & media**

- `storage_operations_total{driver,operation,result,role}` and
  `storage_operation_duration_seconds{driver,operation,result,role}` —
  `driver=s3|local|memory`, `result=success|error`, bounded `operation` set
  (`upload`, `download`, `download_stream`, `get_metadata`, `delete`,
  `delete_many`, `exists`, `list`, `copy`, `move`, `signed_download_url`,
  `signed_upload_url`). Object keys, buckets, endpoints, and URLs are never labels.
- `media_operations_total{preset,operation,result,role}` and
  `media_operation_duration_seconds{preset,operation,result,role}` —
  `preset=avatar`, `operation=process|delete_derivatives`.

**Email**

- `email_operations_total{template,operation,mode,result,retryable,role}` and
  `email_operation_duration_seconds{template,operation,mode,result,role}` —
  `operation=dispatch|render|send|process`, `mode=queued|direct|worker`,
  `result=success|error|discarded`,
  `template=welcome|password-reset|email-verification|org-invite|notification|unknown`.
- `email_dead_letters_total{template,unrecoverable,role}`. Recipients, provider
  IDs, job IDs, payloads, and error messages are never labels.

**Realtime SSE** (notification + AI run status streams; no user/IP/event IDs)

- `notification_realtime_connections{role}` and `ai_run_realtime_connections{role}` —
  open-stream gauges.
- `notification_realtime_publish_total{outcome,role}` and
  `ai_run_realtime_publish_total{outcome,role}` —
  `outcome=published|failed|dropped`.
- `notification_realtime_events_total{event,role}` and
  `ai_run_realtime_events_total{event,role}` —
  `event=received|routed|no_local_target|invalid_envelope|rejected_global|rejected_user|slow_close|startup_failure`
  (`rejected_global`=503 admission, `rejected_user`=429, `slow_close`=slow
  consumer disconnected on buffer overflow).

**AI** (no prompt/response content, model slug, credential, or reason as a label)

- `ai_generations_total{provider,operation,result,role}` (`provider` is the
  lowercase provider _type_, `operation=text|object`, `result=success|error`),
  `ai_tokens_total{provider,direction,role}` (`direction=input|output`).
- `ai_guardrail_checks_total{stage,verdict,role}` (`stage=input|output`,
  `verdict=allow|flag|block`).
- `ai_tool_invocations_total{tool_id,risk_class,outcome,role}` (`tool_id` bounded
  to the code-owned registry, `risk_class=safe|sensitive|destructive`,
  `outcome=succeeded|failed|rejected|skipped`), `ai_tool_loop_steps{outcome,role}`
  (`outcome=completed|exhausted|failed`).
- `ai_approvals_total{kind,state,role}`
  (`kind=tool_invocation|handoff|sensitive_action`,
  `state=pending|approved|rejected|expired`).
- `ai_assistant_admin_total{action,role}`
  (`action=created|version_published|updated|enabled|disabled`).
- `ai_conversation_control_total{action,actor_role,role}`
  (`action=taken_over|released|operator_message`, `actor_role=owner|operator`).
- `ai_artifact_uploads_total{kind,result,role}` (`kind=image|pdf`,
  `result=success|rejected`),
  `ai_artifact_resolution_total{result,role}`
  (`result=success|not_found|capability_unsupported|storage_error`).

OpenTelemetry tracing is optional and not exported by default.

## Operator Interpretation

- **Queue depth is shared Redis state, not per-process.** Never sum
  `amcore_queue_jobs` across replicas; aggregate non-additively:

  ```promql
  max by(queue, state) (amcore_queue_jobs)
  ```

- **Cache counters are per Redis read, not per request** — under cache-stampede
  lock contention one lookup may re-read the cache several times. Compute hit
  ratios from the counters (`hit / (hit + miss)`), never against request counts.
  `negative_hit` comes only from the explicit user negative-cache envelope (a
  cached permissions `[]` is a normal `hit`); a corrupt entry emits both `corrupt`
  and `miss` because it is deleted and re-handled as a miss.
- **Email `discarded` is not success** — secret-bearing legacy queue jobs and
  unknown job types are counted `discarded`; terminal failures also increment
  `email_dead_letters_total`.
- **Health routes** are excluded from request logs but **counted** in HTTP metrics.

## Label Rules

Labels must stay bounded and non-sensitive.

**Allowed:** process role (`web|worker|all`); normalized HTTP route templates
(`/organizations/:id`); status code; bounded queue/cache/storage/email/media
operation names.

**Forbidden:** raw URLs, query strings, or route regex internals; user,
organization, session, invite, API-key, or job IDs; email addresses, phone
numbers, IP addresses, user agents; object keys, buckets, signed URLs, Redis
keys; tokens, token/API-key hashes, password fields; prompt text or provider
payloads.

If a safe route template cannot be derived, AMCore uses a bounded fallback such as
`unknown` instead of the raw path.

## Add a metric

Metrics are centralized in
[`MetricsService`](../../apps/api/src/infrastructure/observability/metrics.service.ts)
so labels, naming, and the `enabled` gate stay uniform. `ObservabilityModule`
exports the service; inject it wherever you emit. Two shapes:

**Instrument-owned counter / histogram / gauge** — the common case. Register the
name, declare the instrument, and expose a typed, guarded emit method:

1. Add the name to `METRIC_NAMES` in
   [`metrics.constants.ts`](../../apps/api/src/infrastructure/observability/metrics.constants.ts)
   with the `amcore_` prefix (`amcore_refunds_total`).
2. Declare the field and create it in the constructor via the
   `getOrCreateCounter` / `getOrCreateHistogram` / `getOrCreateGauge` helpers,
   with a `help` string and `labelNames`.
3. Add an emit method that **guards on `enabled`** and injects the process role:

   ```ts
   incRefund(outcome: RefundOutcome, result: RefundResult): void {
     if (!this.enabled) return
     this.refundsTotal.inc({ outcome, result, role: this.role })
   }
   ```

**Externally-collected gauge** (sampled from a pool, queue, or other live source
at scrape time) — use the public `registerGauge({ name, help, labelNames,
collect })`, whose `collect` callback runs on each scrape. Registration is
**first-wins** (reusing a name keeps the original callback). The DB-pool and
queue-depth collectors are the reference pattern.

**Label discipline is the contract, not a style preference.** Every label must
satisfy the [Label Rules](#label-rules): bounded and non-sensitive. Give each
label a **closed string-union type** (as the existing `…Outcome` / `…Result`
types do) so its cardinality can't drift, and coerce any value derived from
caller input to a bounded fallback (`unknown`) rather than passing it through —
the `tool_id` label is the worked example. Never label a metric with an id, URL,
object key, token, email, prompt, or any free-form value.

After adding one, extend the [Metric Families](#metric-families) list above so the
family reference stays complete, and cover the emit path in the metrics unit
specs.

## Web and Worker Roles

`PROCESS_ROLE=web`, `worker`, and `all` all expose metrics. The worker has no
business API routes and no Bull Board, but does expose health and metrics so
Kubernetes can probe it and Prometheus can scrape it.
