# Realtime runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-realtime`
group. Every alert here is `or`-combined across the notification and AI-run
streams (`amcore_notification_realtime_*` / `amcore_ai_run_realtime_*`) since
both share the same underlying SSE transport and failure modes.

## Rejected

**Symptom:** `AMCoreRealtimeRejectedUserTicket` (per-user cap refusing for
15m) or `AMCoreRealtimeRejectedGlobalPage` (global cap refusing for 5m) is
firing.

**Likely causes, ranked:**

1. **User-scoped:** a client reconnect storm (flaky network causing rapid
   reconnect attempts) or a legitimately high number of tabs/devices for one
   user, both bumping into `NOTIFICATIONS_REALTIME_MAX_PER_USER` /
   `AI_REALTIME_MAX_PER_USER` (default 5).
2. **Global:** a genuine traffic surge in concurrent realtime clients, or a
   client-side bug causing many more connections than intended per user
   across many users at once.
3. Deliberate abuse (a single actor opening many connections) — less likely
   than the above two but worth checking if the pattern is concentrated on
   one user/IP rather than spread out.

**Diagnostic steps:**

1. Query directly:

   ```promql
   label_replace(rate(amcore_notification_realtime_events_total{event="rejected_user"}[5m]), "stream", "notifications", "", "") or label_replace(rate(amcore_ai_run_realtime_events_total{event="rejected_user"}[5m]), "stream", "ai-runs", "", "")
   label_replace(rate(amcore_notification_realtime_events_total{event="rejected_global"}[5m]), "stream", "notifications", "", "") or label_replace(rate(amcore_ai_run_realtime_events_total{event="rejected_global"}[5m]), "stream", "ai-runs", "", "")
   ```

2. Open the **"Events by type (notifications)"** / **"Events by type (AI
   runs)"** dashboard panels (Realtime row) and look at the `rejected_user`/
   `rejected_global` series directly.
3. Check the **"Open connections"** dashboard panel (Realtime row, a gauge —
   dashboard-only, not alerted; see `docs/operations/observability.md`'s
   Operator Interpretation notes) to see whether the rejection is happening
   at genuinely high overall connection counts (surge-shaped) or a low
   overall count concentrated on one user (reconnect-storm-shaped).
4. For the per-user case, this is a rate of _sustained_ rejection, not a
   single occurrence — a 6th tab from the same user is ordinary and expected,
   not an incident by itself.

**Mitigation:**

- If a reconnect storm from unstable client networking: this generally
  self-resolves once the client's network stabilizes; no server-side action
  needed unless it's sustained and affecting many users.
- If legitimate usage is regularly hitting the per-user cap: raise
  `NOTIFICATIONS_REALTIME_MAX_PER_USER` / `AI_REALTIME_MAX_PER_USER` to match
  real client behavior.
- If a genuine global surge: scale `web`/`all`-role replica count if the cap
  is infrastructure-bound, or raise the global cap if capacity allows.
- If concentrated abuse from one actor: address at the application/auth layer
  (this alert only observes the SSE admission effect, not the actor).

**Escalation:** `Ticket` (per-user, 15m sustained) — check config before
assuming abuse. `Page` (global, 5m) means every rejected client sees no live
updates at all — escalate per your organization's on-call process.

## Dropped

**Symptom:** `AMCoreRealtimeDroppedTicket` (any drop in 15m) or
`AMCoreRealtimeDroppedPage` (dropping for 5m straight) is firing — arguably
the highest-severity realtime signal, since it means a client that _was_
connected silently missed an update.

**Likely causes, ranked:**

1. Redis `PUBLISH` calls are slow, hung, or repeatedly failing, leaving the
   process-wide number of unsettled publishes at `*_MAX_INFLIGHT_PUBLISH`.
2. A burst of publishes is arriving faster than Redis can complete them,
   exhausting the same process-wide in-flight allowance.

**Diagnostic steps:**

1. Query directly:

   ```promql
   label_replace(increase(amcore_notification_realtime_publish_total{outcome="dropped"}[15m]), "stream", "notifications", "", "") or label_replace(increase(amcore_ai_run_realtime_publish_total{outcome="dropped"}[15m]), "stream", "ai-runs", "", "")
   ```

2. Open the **"Dropped publishes"** dashboard panel (Realtime row) to see the
   trend and scale.
3. Check `publish_total{outcome="failed"}`, the Redis **"Client event rate"**
   panel, and Redis **"Ping latency"** in the same window. `slow_close` is a
   separate per-connection queue-overflow signal; it does not explain or
   confirm a process-wide publish drop.

**Mitigation:**

- If Redis is degraded: restore the publish path first; raising the in-flight
  allowance only delays the drop and can increase memory pressure.
- If burst-driven: check whether the burst is legitimate or a producer bug.
  Tune `*_MAX_INFLIGHT_PUBLISH` only after measuring normal publish latency
  and capacity; it is a process-wide concurrency guard, not a per-client
  buffer.

**Escalation:** `Ticket` (any drop in 15m) — investigate; every drop is a
missed update for a connected client. `Page` (sustained 5m) — escalate per
your organization's on-call process; treat this as a real user-facing gap in
delivery, not a cosmetic metric.

## Invalid envelope

**Symptom:** `AMCoreRealtimeInvalidEnvelopeTicket` (any invalid envelope in
15m) or `AMCoreRealtimeInvalidEnvelopePage` (sustained for 15m) is firing.

**Likely causes, ranked:**

1. A rolling deploy across a namespace/version skew — **expected** during a
   normal rolling deploy and should self-resolve within the deploy's own
   timeframe, well under this alert's 15m windows.
2. A genuine namespace/version mismatch outside of any deploy (a
   misconfigured `*_REALTIME_NAMESPACE` on one replica but not others).

**Diagnostic steps:**

1. Query directly:

   ```promql
   label_replace(increase(amcore_notification_realtime_events_total{event="invalid_envelope"}[15m]), "stream", "notifications", "", "") or label_replace(increase(amcore_ai_run_realtime_events_total{event="invalid_envelope"}[15m]), "stream", "ai-runs", "", "")
   ```

2. Open the **"Events by type (notifications)"** / **"Events by type (AI
   runs)"** dashboard panels (Realtime row) and look at the
   `invalid_envelope` series to confirm the trend and duration.
3. Check whether a rolling deploy was in progress in the same window (deploy
   timeline vs. alert firing time) — if so, and it has since completed, this
   is expected and should already be clearing.
4. If no deploy was in progress, check `*_REALTIME_NAMESPACE` configuration
   consistency across all `web`/`all`-role replicas.

**Mitigation:**

- If deploy-correlated and the deploy has completed: none needed; confirm the
  alert clears on its own shortly.
- If a genuine namespace mismatch: fix the configuration drift across
  replicas and redeploy consistently.

**Escalation:** `Ticket` (any occurrence) — expected during a rolling deploy,
so check the deploy timeline before treating as an incident. `Page` (15m
sustained) is longer than a rolling deploy should take — escalate per your
organization's on-call process and check for a genuine mismatch.

## Startup failure

**Symptom:** `AMCoreRealtimeStartupFailureTicket` (any failure in 15m) or
`AMCoreRealtimeStartupFailurePage` (sustained for 5m) is firing — a realtime
stream was admitted (passed the connection cap) but died before opening.

**Likely causes, ranked:**

1. The client or an intermediary closed the socket while the server was
   writing the SSE response headers or initial `: ready` frame.
2. A proxy/socket write failure, or a code regression in that narrow stream
   open path, was introduced by a recent deploy.

**Diagnostic steps:**

1. Query directly:

   ```promql
   label_replace(rate(amcore_notification_realtime_events_total{event="startup_failure"}[5m]), "stream", "notifications", "", "") or label_replace(rate(amcore_ai_run_realtime_events_total{event="startup_failure"}[5m]), "stream", "ai-runs", "", "")
   ```

2. Open the **"Events by type (notifications)"** / **"Events by type (AI
   runs)"** dashboard panels (Realtime row) and look at the `startup_failure`
   series to confirm the trend.
3. Check the **"Build info"** dashboard panel (Build info row) for a recent
   deploy correlated with the failure onset.
4. Search structured logs for `Notification SSE stream failed to start after
admission` or `AI run SSE stream failed to start after admission`, then
   correlate with proxy and client-disconnect errors at the same timestamp.

**Mitigation:**

- If client/proxy-disconnect-related: correct intermediary timeouts or client
  reconnect behavior; the failure occurs after admission but while the
  response is being opened.
- If deploy-correlated: roll back per `docs/operations/production-deploy-profile.md`.

**Escalation:** `Ticket` (any occurrence in 15m) — investigate. `Page` (5m
sustained) means realtime streams are repeatedly failing to start —
escalate per your organization's on-call process.
