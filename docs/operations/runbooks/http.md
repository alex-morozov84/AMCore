# HTTP runbooks

Use this runbook for [HTTP error-ratio alerts](../prometheus/amcore-alerts.yml)
and [optional SLO burn-rate alerts](../prometheus/optional/amcore-slo-burn-rate.yml).
The ratio excludes health probes.

## 5xx error ratio

**Symptom:** `AMCoreHttp5xxRatioTicket` (>0.1% for 6h), `AMCoreHttp5xxRatioPageFast`
(>5% for 5m), or `AMCoreHttp5xxRatioPageSustained` (>1% for 1h) is firing.

**Likely causes, ranked:**

1. A recent deploy introduced a regression on one or a few routes.
2. A downstream dependency (Postgres, Redis, an AI provider) is failing and the
   app is surfacing that as `5xx` rather than degrading gracefully.
3. A single hot route with a genuine bug, amplified by its own traffic share.

**Diagnostic steps:**

1. Break the alert's own aggregate query down by route to find which route(s)
   have elevated error ratios. Compare the request rate and absolute 5xx rate
   before choosing which route to investigate. An infrequent route can have a
   high ratio and contribute few errors to the aggregate:

   ```promql
   sum(rate(amcore_http_requests_total{status_code=~"5..",route!~"/api/v1/health.*"}[5m])) by (route)
   /
   sum(rate(amcore_http_requests_total{route!~"/api/v1/health.*"}[5m])) by (route)
   ```

2. Open the **"5xx error ratio"** dashboard panel (HTTP row) to see
   whether the rise is sudden (deploy-shaped) or a slow climb, and the
   **"Build info"** panel (Build info row) to read the currently deployed
   `version`/`commit` and correlate against the deploy timeline.
3. Check the **"p99 latency by route"** panel (HTTP row) for the same route(s) — a
   failing downstream dependency usually shows as elevated latency _and_
   elevated 5xx together, not 5xx alone.
4. If a dependency is suspected, follow [`db.md`](db.md) or [`redis.md`](redis.md)
   for that dependency's own alerts and diagnostics.

**Mitigation:**

- If correlated with a recent deploy: roll back to the last known-good image
  digest using the [rollback procedure](../deployment.md#rollback). Confirm
  schema and worker compatibility before choosing an image-only rollback.
- If correlated with a downstream dependency: mitigate that dependency first
  (see the linked runbook); the 5xx ratio should recover once it does.
- If isolated to one route with no recent deploy or dependency signal: treat
  as an application bug on that route and open an incident to investigate the
  handler directly.

**Escalation:** `AMCoreHttp5xxRatioTicket` is a non-urgent follow-up — file a
ticket and investigate before the ratio grows. Either page-severity alert
(`Fast` or `Sustained`) means the error ratio crossed the page threshold;
check impact and escalate per your
organization's on-call process. This starter ships no default paging
integration (see `docker/monitoring/alertmanager/alertmanager.yml`) — wire one
before relying on paging in production.

**Verify recovery:** Confirm traffic still reaches the affected routes. Compare
5xx rate, error ratio and latency with the pre-incident baseline. An empty
series or a quiet notification channel cannot confirm recovery.

## SLO burn-rate

**Symptom:** `AMCoreErrorBudgetPageBurn` or `AMCoreErrorBudgetTicketBurn` is
firing. These only exist if a fork has enabled the optional
`docs/operations/prometheus/optional/amcore-slo-burn-rate.yml` file (off by
default — see that file's header for how to enable it).

**Diagnostics and mitigation:** Use [5xx error ratio](#5xx-error-ratio).
A burn-rate alert can fire independently of the fixed-ratio alerts.

**Escalation:** `AMCoreErrorBudgetPageBurn` uses one rule for the fast
(1h/5m) and slow (6h/30m) conditions. The fixed-ratio alerts are separate rules.
`AMCoreErrorBudgetTicketBurn` is a non-urgent
budget-consumption signal, not a page.
