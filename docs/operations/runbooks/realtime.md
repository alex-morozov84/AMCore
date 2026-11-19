# Realtime runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-realtime`
group. The rules cover notification and AI-run SSE streams. Use the stream and
instance labels in the diagnostic queries to locate the signal.

**Verify recovery:** Confirm new streams open and an affected client receives
a fresh update for the relevant stream. Compare with the persisted state or
read it directly if the live hint is missing. Falling counters alone do not
confirm delivery.

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
   ```

   ```promql
   label_replace(rate(amcore_notification_realtime_events_total{event="rejected_global"}[5m]), "stream", "notifications", "", "") or label_replace(rate(amcore_ai_run_realtime_events_total{event="rejected_global"}[5m]), "stream", "ai-runs", "", "")
   ```

2. Open the **"Events by type (notifications)"** / **"Events by type (AI
   runs)"** dashboard panels (Realtime row) and look at the `rejected_user`/
   `rejected_global` series directly.
3. Check the **"Open connections"** dashboard panel (Realtime row) for load.
   The gauge cannot identify a user or IP. Confirm client reconnect behavior
   separately before attributing the signal to a particular cause.
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
- If a genuine global surge: check capacity and traffic distribution before
  scaling API replicas with the `web` or `all` role, or changing the per-process cap.
- If concentrated abuse from one actor: address at the application/auth layer
  (this alert only observes the SSE admission effect, not the actor).

**Escalation:** `Ticket` (per-user, 15m sustained) — check config before
assuming abuse. `Page` (global, 5m) means every rejected client sees no live
updates at all — escalate per your organization's on-call process.

## Dropped

**Symptom:** `AMCoreRealtimeDroppedTicket` (any drop in 15m) or
`AMCoreRealtimeDroppedPage` (dropping for 5m straight) is firing. The publisher skipped a live update hint. The counter cannot
identify an affected client or establish a durable data loss.

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
3. Check `publish_total{outcome="failed"}`, the **"Client event rate"** panel
   (Redis row), and the **"Ping latency"** panel (Redis row) in the same
   window. `slow_close` is a
   separate per-connection queue-overflow signal; it does not explain or
   confirm a process-wide publish drop.

**Mitigation:**

- If Redis is degraded: restore the publish path first; raising the in-flight
  allowance only delays the drop and can increase memory pressure.
- If burst-driven: check whether the burst is legitimate or a producer bug.
  Tune `*_MAX_INFLIGHT_PUBLISH` only after measuring normal publish latency
  and capacity; it is a process-wide concurrency guard, not a per-client
  buffer.

**Escalation:** Investigate a ticket. Escalate a page through your on-call
process and confirm the effect on the affected stream.

## Invalid envelope

**Symptom:** `AMCoreRealtimeInvalidEnvelopeTicket` (any invalid envelope in
15m) or `AMCoreRealtimeInvalidEnvelopePage` (sustained for 15m) is firing.

**Diagnostics:**

1. Identify stream and instance with the 15-minute increase in invalid
   envelopes.

   ```promql
   label_replace(increase(amcore_notification_realtime_events_total{event="invalid_envelope"}[15m]), "stream", "notifications", "", "") or label_replace(increase(amcore_ai_run_realtime_events_total{event="invalid_envelope"}[15m]), "stream", "ai-runs", "", "")
   ```

2. Check the deployed versions and producer/subscriber configuration. A
   subscriber counts oversize or rejected messages it receives on its channel.
   A namespace mismatch can instead prevent messages from reaching it at all.
3. Check the deploy timeline for a producer or format change. A rolling deploy
   alone does not establish the cause or make invalid envelopes expected.

**Mitigation and escalation:** Correct confirmed namespace or format drift
using a compatible deployment. Escalate a sustained page. Verify delivery
after the change even if the invalid-envelope series goes quiet.

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

1. For a ticket, check increases over the full 15-minute window:

   ```promql
   label_replace(increase(amcore_notification_realtime_events_total{event="startup_failure"}[15m]), "stream", "notifications", "", "") or label_replace(increase(amcore_ai_run_realtime_events_total{event="startup_failure"}[15m]), "stream", "ai-runs", "", "")
   ```

   For a page, check the 5-minute rate and its 5-minute hold:

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
- If deploy-correlated: roll back per [the rollback procedure](../deployment.md#rollback).

**Escalation:** `Ticket` (any occurrence in 15m) — investigate. `Page` (5m
sustained) means realtime streams are repeatedly failing to start —
escalate per your organization's on-call process.
