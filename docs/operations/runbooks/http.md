# HTTP runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-http-errors`
group and the optional `docs/operations/prometheus/optional/amcore-slo-burn-rate.yml`.
Every query below excludes health-check probe traffic
(`route!~"/api/v1/health.*"`), matching the alert expressions themselves.

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
   are driving it — the alert sums across every route, so this is always the
   first step:

   ```promql
   sum(rate(amcore_http_requests_total{status_code=~"5..",route!~"/api/v1/health.*"}[5m])) by (route)
   /
   sum(rate(amcore_http_requests_total{route!~"/api/v1/health.*"}[5m])) by (route)
   ```

2. Open the **"5xx error ratio"** dashboard panel (Grafana, HTTP row) to see
   whether the rise is sudden (deploy-shaped) or a slow climb, and the
   **"Build info"** panel to read the currently deployed `version`/`commit`
   and correlate against the deploy timeline.
3. Check the **"p99 latency by route"** panel for the same route(s) — a
   failing downstream dependency usually shows as elevated latency _and_
   elevated 5xx together, not 5xx alone.
4. If a dependency is suspected, follow [`db.md`](db.md) or [`redis.md`](redis.md)
   for that dependency's own alerts and diagnostics.

**Mitigation:**

- If correlated with a recent deploy: roll back to the last known-good image
  digest per `docs/operations/production-deploy-profile.md`.
- If correlated with a downstream dependency: mitigate that dependency first
  (see the linked runbook); the 5xx ratio should recover once it does.
- If isolated to one route with no recent deploy or dependency signal: treat
  as an application bug on that route and open an incident to investigate the
  handler directly.

**Escalation:** `AMCoreHttp5xxRatioTicket` is a non-urgent follow-up — file a
ticket and investigate before the ratio grows. Either page-severity alert
(`Fast` or `Sustained`) means an ongoing, real outage; escalate per your
organization's on-call process. This starter ships no default paging
integration (see `docker/monitoring/alertmanager/alertmanager.yml`) — wire one
before relying on paging in production.

## SLO burn-rate

**Symptom:** `AMCoreErrorBudgetPageBurn` or `AMCoreErrorBudgetTicketBurn` is
firing. These only exist if a fork has enabled the optional
`docs/operations/prometheus/optional/amcore-slo-burn-rate.yml` file (off by
default — see that file's header for how to enable it).

**Likely causes and diagnostics:** the same underlying 5xx elevation as
above, viewed through a monthly error-budget lens instead of the fixed
percentages above — if either burn-rate alert fires, one or more of the
5xx-error-ratio alerts in the previous section is very likely firing too (or
about to). Start with that section's diagnostic steps; there is no separate
burn-rate-specific diagnostic beyond the multiwindow condition the alert
itself already evaluates (see the file's own header comment for the burn-rate
math).

**Mitigation:** identical to [5xx error ratio](#5xx-error-ratio) above — the
SLI being burned is the same one.

**Escalation:** `AMCoreErrorBudgetPageBurn` combines the fast (1h/5m) and slow
(6h/30m) page-severity windows into one alert by design (see the file's
header) specifically so a severe outage never sends two separate page
notifications for the same incident — treat it as a single page regardless of
which window pair tripped it. `AMCoreErrorBudgetTicketBurn` is a non-urgent
budget-consumption signal, not a page.
