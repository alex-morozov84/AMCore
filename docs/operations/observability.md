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
octet zeroed; IPv6 reduced to its network prefix). The source IP is Express
`req.ip`: by default this is the socket peer and ignores spoofable
`X-Forwarded-*` headers; behind a trusted reverse proxy/load balancer, set
`TRUST_PROXY` to the real topology so logs, audit records, and rate limiting use
the real client IP. Health routes are excluded from request logs to reduce noise.

Sensitive data is redacted before logs leave the process: passwords, password
hashes, refresh/access/OAuth tokens, API keys, cookies, authorization headers,
token-bearing action URLs, AI operator reasons, provider bodies, and other known
secret-bearing fields. **New code must not log** raw request bodies, rendered
email bodies, object keys, prompt/provider payloads, or free-form user content
unless a feature-specific public doc explicitly allows that field.

Email addresses in log lines (queued/processed/sent/dead-lettered email jobs)
are redacted via `redactEmail()` (`a***@example.com` — domain kept, since
delivery/bounce triage is overwhelmingly domain-level) rather than the
`logging.config.ts` redact list: Pino's own redaction fully replaces a value
with `[Redacted]`, which would destroy the domain. A stable `userId` pseudonym
travels alongside the redacted address on the queued-email job payload so
"which account's email failed" stays answerable after the job's own retention
window, without a raw address ever reaching a rotated log file. Auth's own
`User registered`/`User logged in` log lines already carry `userId` and drop
the raw `email` field entirely — no pseudonym gap to fill there, so no
redaction is needed, only the surplus field's removal.

## Log Shipping (Non-Goal)

AMCore deliberately does not ship a log-shipping/aggregation layer. Structured
Pino JSON goes to each container's stdout only; `docker-compose.prod.yml`'s
shared `x-logging` block rotates it via Docker's own `local` driver
(`COMPOSE_LOG_DRIVER`, default `local` — the only other accepted value is
`json-file`; anything else, e.g. `syslog`/`journald`, uses different option
names entirely and fails at container **start**, not at `compose config`
time) at `COMPOSE_LOG_MAX_SIZE`/`COMPOSE_LOG_MAX_FILE` (default `20m` × `5`
files per container — see `.env.example`). This bounds disk usage
automatically; it does not make history searchable.

The direct consequence under the shipped default (`local` driver): once a log
line rolls past that 20MB×5 window, it is gone. There is no documented way to
search historical logs, and no way to correlate a `correlationId` across the
`api` and `worker` processes once either has rotated past the point where a
given request's lines lived — `local`'s own files are for the Docker daemon
and `docker logs`/`docker compose logs` only, not for an external shipper to
read directly (see `.env.example`'s own comment and the file's `x-logging`
comment). Switching `COMPOSE_LOG_DRIVER` to `json-file` is the documented
escape hatch when an external tool needs the raw files directly, but AMCore
does not itself ship or configure that tool, a shipping pipeline, or a
searchable log store — a fork needing durable, searchable, cross-process log
history is expected to add a real shipper (Vector, Fluent Bit, a platform's
own log-shipping sidecar) reading from `json-file` on top of this, the same
way this repo ships an exemplary metrics/alerting/dashboard surface but
expects a fork to wire its own paging integration (see
[Alerting](#alerting) below).

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
  `http_request_duration_seconds{…}` — captured on `res.on('finish')` **or**
  `res.on('close')`, whichever fires first, so guard rejections, unmatched
  routes, and client aborts are all counted. `/api/v1/metrics` is excluded
  from its own HTTP metrics.
- `http_requests_in_flight{method,role}` — **not** labeled by route: the route
  hasn't resolved yet when a request enters/leaves flight (before Express
  matches it), so a `route` label here could only ever hold one placeholder
  value.
- `metrics_collector_errors_total{collector}`.
- `build_info{version,commit,node_version,role}` — a static info-metric, value
  always `1`; `version`/`commit` come from the deployer (`APP_VERSION`/
  `APP_COMMIT`), `unknown` if unset (e.g. local dev).
- `db_pool_connections{state,role}` (`state=total|idle|waiting`),
  `db_slow_queries_total{role}` — collected from the process-local pool; no query
  text or model names. Deliberately: this metric answers "are slow queries
  occurring," not "which one" — see
  [Slow query investigation](slow-query-investigation.md) for that (Postgres's
  own `pg_stat_statements`, queried directly, not scraped into Prometheus).
- `redis_client_events_total{client,event,role}` — `client` is one of
  `shared`, `queue_producer`, `queue_worker`, `throttler` (unchanged since
  ADR-073 — it describes the Redis-client role, not the specific storage
  implementation behind it), `notif_subscriber`, or `ai_run_subscriber`;
  `event=error|reconnecting|degraded`.
- `redis_ping_seconds` — round-trip latency of a `PING` against the shared
  Redis client, sampled at scrape time. A cheap interim signal; a real
  per-command latency histogram is a separate, larger follow-up.
- `rate_limit_decisions_total{policy,outcome,role}` (ADR-073) — every global
  rate-limit admission decision. `policy` is bounded to `default`,
  `privileged_mutation`, `expensive_action`, or `custom` (object-identity
  match against `RATE_LIMIT_POLICIES`, never a route/tracker/free-text
  label — `custom` covers an inline policy, e.g. the Telegram webhook's);
  `outcome=allowed|refused`. The calibration signal for revisiting
  `DEFAULT.burst` against real production traffic.

**Queues** (exported by `worker`/`all` only — absent on `web`)

- `queue_jobs{queue,state,role}` —
  `state=waiting|active|delayed|completed|failed|prioritized|waiting_children`.
  BullMQ 6 removed `paused` as a per-job state — jobs in a paused queue are
  counted as `waiting`. Use `queue_paused` below for pause/resume observability.
- `queue_paused{queue,role}` — `1` if the queue is currently paused, `0`
  otherwise, from `Queue.isPaused()`.
- `queue_events_total{queue,event,role}` —
  `event=job_added|redis_error|redis_reconnecting|worker_error|dead_letter`. Job
  IDs and job names are never labels.
- `notification_delivery_backlog{status}` (`status=pending|processing|
retry_scheduled`) and `notification_delivery_due` (no labels) — the
  `notifications` queue carries only one-attempt wake jobs (ADR-052); the real
  backlog is these `notification_deliveries` rows, which `queue_jobs` never
  reflects. `_due` counts only rows actionable right now (`pending` past
  `availableAt`, or `retry_scheduled` past `nextAttemptAt`) — the alertable
  quantity; the per-status backlog also includes healthy future-scheduled work.
- `ai_run_backlog{status}` (`status=queued|running|waiting_approval|
waiting_human`) and `ai_run_due` (no labels) — the same pattern for the
  `ai-runs` wake-job queue (ADR-054) over `ai_runs` rows. `_due` excludes
  `waiting_approval`/`waiting_human` (intentionally parked for a human, not
  stuck).

**Cache**

- `cache_operations_total{cache,result,role}` — `cache=user|permissions|
ai_catalog`, `result=hit|negative_hit|miss|db_fallback|corrupt`.

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

**One deliberate exception: `build_info`'s `version`/`commit` labels are
free-form strings, not a closed union.** This is the standard Prometheus
info-metric pattern — cardinality is bounded by the number of versions ever
deployed (not request input), and the label set is constant for the
process's whole lifetime. Not a precedent for a free-form label anywhere
else; every other metric in this file follows the closed-union rule above.

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

## Local Verification Harness

An optional `monitoring` Docker Compose profile ships a dev-only
Prometheus + Grafana + Alertmanager stack that scrapes **this repo's own**
`api`/`worker` containers over the real, authenticated `/api/v1/metrics`
path above — it exists to prove the metric surface, alert rules, and
dashboards this repo ships actually work, before a fork wires its own
production monitoring stack. It is never part of `docker-compose.prod.yml`
and is not itself a production monitoring stack.

```bash
# .env: set METRICS_AUTH_TOKEN and GF_SECURITY_ADMIN_PASSWORD first — both
# are required; Compose refuses to start prometheus/grafana otherwise.
docker compose --profile local-infra --profile monitoring up -d
```

- **Prometheus** — `http://localhost:9090`, scrapes `api`/`worker` with a
  bearer token sourced from a Compose secret (never written to a tracked
  file), so the harness always exercises the same authenticated path a real
  deployment must use, never the open default.
- **Grafana** — `http://localhost:3001`, Prometheus datasource
  auto-provisioned; sign in as `admin` with the password you set. No default
  admin password ships — an unset `GF_SECURITY_ADMIN_PASSWORD` fails the
  container at startup rather than falling back to one.
- **Alertmanager** — `http://localhost:9093`.
- All three ports are loopback-only (`127.0.0.1`).

**`GF_SECURITY_ADMIN_PASSWORD` only sets the _initial_ password for a fresh
`grafana_data` volume** — it does not rotate an existing one on a later
`up`/restart, since Grafana persists its own user database there. Changing
the `.env` value alone after the volume already exists has no effect (the
old password keeps working, the new one doesn't). To actually change it: set
the new value in `.env`, recreate only `grafana` so it picks the new value
up, then reset from that same container-local env var — never typing the
password itself into a command, which would otherwise leak it into shell
history and process listings:

```bash
docker compose --profile monitoring up -d --no-deps --force-recreate grafana
docker compose --profile monitoring exec grafana sh -c \
  'printf "%s" "$GF_SECURITY_ADMIN_PASSWORD" | grafana cli admin reset-admin-password --password-from-stdin'
```

`docker/monitoring/grafana/dashboards/amcore-overview.json` ships one
dashboard — Grafana's own dashboard provisioning loads it automatically
from the bind-mounted directory, no click-through needed — covering every
metric-family category below, one row per category, verified against real
scraped data from this same harness. Alert rules and Alertmanager routing
also ship — see "Alerting" below.

## Alerting

`docs/operations/prometheus/amcore-alerts.yml` ships one Prometheus rule
group per metric category above (HTTP errors, Node runtime, metrics
collector health, DB, Redis, queues, email, realtime). Every rule carries
`severity: ticket` (an operator follow-up, not urgent) or `severity: page`
(meant to wake someone) and a `runbook_path` — a **repo-relative path, not
a URL** (named honestly rather than as `runbook_url`, since Alertmanager
cannot resolve a bare relative path against a Git checkout the way a real
hyperlink would need) — a fork's own checkout has the linked file at the
same relative location regardless of its Git remote. `docs/operations/runbooks/`
ships one file per category (`http`, `node-runtime`,
`metrics-collector-health`, `db`, `redis`, `queues`, `email`, `realtime`),
each anchor matching a `runbook_path` above exactly: symptom, ranked likely
causes, diagnostic steps with executable PromQL derived from the rule and the matching
dashboard panel, mitigation, and escalation guidance.

Every alert is proven, not just written: every one of the 32 rules in
`docs/operations/prometheus/tests/amcore-alerts_test.yml` has both a
firing-case test (fires on a constructed bad case) and a genuine
healthy-case test (`exp_alerts: []`, stays silent when nothing is wrong).
Every alert that joins two metric families with a boolean `or`/`and` — the
paused-queue gate, the outbox backlog, all eight `or`-combined realtime
alerts — additionally has an asymmetric-health firing test (one side
explicitly healthy, the other firing): a _positive_ assertion that the
alert still fires correctly, proving neither side can mask or leak into
the other. An earlier draft of the outbox alerts had exactly that masking
bug (a bare `(amcore_notification_delivery_due or amcore_ai_run_due) > N`
silently returns only whichever side PromQL's `or` happens to keep once
the two series' label sets match, hiding the other's real value
completely) — caught by review before it ever shipped, which is why this
test class is mandatory here, not just encouraged.
`docker/monitoring/prometheus/prometheus.yml`'s `rule_files` already
globs this directory, so the alerts load automatically once the
`monitoring` profile is up; CI's `promtool` job runs `promtool check
config`/`check rules`/`test rules` against the exact shipped files on every
PR.

**Deliberately not alerted** (no invented number where the underlying table
in this guide's own design notes gives none, or an explicit "never"): HTTP
saturation (`amcore_http_requests_in_flight`'s "sustained near historical
max" needs a per-fork traffic baseline this starter cannot ship), HTTP
latency's page tier (needs an app-level request timeout budget this starter
does not itself define), realtime `no_local_target` (expected and high in
multi-replica fan-out), realtime connection-count gauges (a bare drop to
zero is normal overnight), realtime slow-close's relative "baseline
rate"/"sharp spike", AI provider/tool-failure rows (provider bursts are
often transient — paging on them trains operators to ignore the channel),
AI approval expiry (a process signal, never a page), and rate-limit burst
calibration (a periodic review input, not an alert). Each is called out
again, in place, as a comment in `amcore-alerts.yml` itself.

**Alertmanager** (`docker/monitoring/alertmanager/alertmanager.yml`) routes
by the `severity` label to a `page` or `ticket` receiver, neither with an
active integration by default — every alert routes successfully today but
reaches no one, since this repo never bakes real credentials into a public
config file. `docker/monitoring/alertmanager/tests/alertmanager.example-full.yml`
is the CI-checked (`amtool check-config`, every PR) example for both
native receiver types this repo expects a fork to actually want, email and
Telegram (no bridge/exporter process needed for either) — copy its
`email_configs`/`telegram_configs` blocks into the real file's receivers
and drop the matching secret file(s) into
`docker/monitoring/alertmanager/secrets/` (gitignored, always mounted into
the container — see its README) to actually receive alerts. One worked
`inhibit_rule` example ships too: a queue-critical Redis client
reconnecting for 5m straight suppresses the queue/outbox backlog alerts
that would otherwise also fire during the same outage — a derived symptom
of the same root cause, not independent new information.

**Binding architectural rule:** AMCore's own notification subsystem
(`in_app`/`email`/`telegram` via `NotificationChannel`) must never carry
infrastructure alerts — both its delivery paths run over the same
Redis/Postgres this alerting exists to monitor, so an alert about (for
example) a Redis outage routed through either path would sit inside the
very queue that is broken. Alertmanager runs beside the app, not inside it;
the email/Telegram receivers above are configured entirely independently of
`NotificationChannel`.

### Optional: SLO burn-rate alerting

`docs/operations/prometheus/optional/amcore-slo-burn-rate.yml` ships a
second, independent alerting layer: Google SRE Workbook-style multiwindow
multi-burn-rate alerting tied to a chosen availability target
(`amcore:slo_target`, shipped at `0.999` — no real AMCore production
traffic exists to derive a target from, so this is a reasoned starting
point, not a measured fact) rather than the fixed percentages
`amcore-alerts.yml` uses. **Off by default**: this `optional/` subdirectory
is not reached by `prometheus.yml`'s `rule_files: - /etc/prometheus/rules/*.yml`
glob (Prometheus globs are not recursive) — enable it by adding
`- /etc/prometheus/rules/optional/*.yml` to that file. Proven the same way,
in `optional/tests/amcore-slo-burn-rate_test.yml`, including a test that the
multiwindow condition is real (a short-lived spike diluted by a healthy
long window must not page).

## Observability Contract Verification

Everything above (metrics, alerts, dashboard, runbooks) is machine-checked as
one maintained contract, not just documented — `scripts/observability-contract/`,
run in two CI tiers on every PR.

**Static tier** (`pnpm test:observability-contract`, part of the `Observability
contract (static)` CI job — no containers): every alert/recording-rule and
dashboard-panel expression structurally extracted; every runbook's fenced
`promql` blocks inventoried (a future untagged fence referencing an
`amcore_*` metric fails); every `runbook_path` and relative Markdown link
resolves to a real file/heading; every dashboard panel/target's datasource
matches the provisioned uid (`docker/monitoring/grafana/provisioning/datasources/prometheus.yml`);
every runbook's `**"Title"** ... panel (X row)` citation names a real
`(row, panel)` pair on the shipped dashboard; the Prometheus/Alertmanager
image digests pinned in `docker-compose.yml` and `.github/workflows/ci.yml`
match; and the public/private-boundary ratchet (below) holds.

**Live tier** (`pnpm test:observability-contract:live`, the `Observability
contract (live)` CI job, `needs: [promtool]` — boots the real `local-infra` +
`monitoring` Compose profiles under an isolated project): the metric-reference
guard queries `GET /api/v1/targets/metadata` scoped to `job=~"amcore-(api|worker)"`
(never Prometheus's own self-scrape families) to build the real exposed-metric
set live, expanding histogram families into `_bucket`/`_sum`/`_count`, and
parses every shipped expression through `POST /api/v1/parse_query` to assert
every referenced name is real; every expression is also evaluated via
`POST /api/v1/query`, distinguishing a genuine query error from a valid empty
result; `GET /api/v1/targets` asserts `amcore-api`/`amcore-worker` are exactly
`up`; `GET /api/v1/rules` asserts exactly the 8 default groups are loaded
and the optional SLO groups are genuinely absent (proving the off-by-default
glob above holds live, not only on paper); `GET /api/v1/alertmanagers` asserts
Alertmanager discovery resolved; and Grafana is checked three ways — the
modern `/apis/dashboard.grafana.app` API (discovers `preferredVersion`, `v2`
on the pinned `13.2.1` image today, and asserts the DTO's `apiVersion` matches
it), the classic `v1` DTO diffed against the committed dashboard JSON
(rows/panels/targets/expr/datasource refs), and a real `POST /api/ds/query`
round trip through Grafana to Prometheus for the `amcore_build_info` target
(catching a query-level error Grafana can return inside an HTTP 200). A
second, fully isolated boot proves the old-volume migration path
`provisioning/datasources/prometheus.yml`'s own header comment describes: a
`grafana_data` volume seeded under the legacy no-uid provisioning
(`docker/monitoring/grafana/provisioning-legacy-fixture/`) is handed the real
provisioning and ends up with the legacy datasource gone and `amcore-prometheus`
healthy. Both tiers tear their Compose stacks down unconditionally (a shell
`trap` plus an `if: always()` CI step).

**Public/private-boundary ratchet:** `scripts/observability-contract/private-path-baseline.json`
is an exact, reviewed `(file, target citation, occurrence count)` snapshot of
every private root `ai/*` citation this repository carried at the time PR7
shipped (7 legitimate — `AGENTS.md`/`CONTRIBUTING.md`/`PROJECT_CONTEXT.md`,
which exist specifically to describe the optional private maintainer overlay
— plus 87 pre-existing citations across 65 files, tracked as their own
maintainer cleanup item rather than rewritten by this PR). The check
fails on any citation not in that exact baseline; a baseline entry may only
shrink. Regenerate it with `node scripts/observability-contract/generate-private-path-baseline.mjs`
only when deliberately fixing a listed `debt` entry — never to silently admit
a new one.
