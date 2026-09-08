# Node runtime runbooks

Covers `docs/operations/prometheus/amcore-alerts.yml`'s `amcore-node-runtime`
group.

## Event loop lag

**Symptom:** `AMCoreEventLoopLagElevated` (p99 > 50ms for 30m) or
`AMCoreEventLoopLagCritical` (p99 > 100ms for 5m) is firing.

**Likely causes, ranked:**

1. CPU-bound synchronous work running on the event loop (large JSON
   serialization, cryptographic hashing, image/media processing done inline
   instead of via a worker/queue).
2. GC pressure from high object churn or a memory leak (check
   [Heap usage](#heap-usage) alongside this).
3. A downstream call that resolves synchronously in a tight loop instead of
   yielding (rare, but worth a code-level check if the above two are ruled
   out).

**Diagnostic steps:**

1. Open the **"Event loop p99 lag"** dashboard panel (Node runtime row) to see
   whether the lag is a steady climb (leak-shaped) or a step change (deploy or
   traffic-shaped).
2. Cross-check the **"Heap used"** panel for the same time window — a
   simultaneous heap climb points at GC pressure as the cause; a flat heap
   with lag climbing alone points at synchronous CPU-bound work.
3. Check the **"Request rate by route"** panel for a traffic-shape change,
   and correlate against the **"Build info"** panel's `version`/`commit` for
   a recent deploy.

**Mitigation:**

- Move inline request-path CPU work to a BullMQ worker. If the firing target
  is already a `worker` role, isolate CPU work in worker threads/a separate
  process or reduce per-process concurrency instead of moving it to another
  handler on the same event loop.
- If GC-pressure-shaped: see [Heap usage](#heap-usage) below.
- If deploy-correlated: roll back per `docs/operations/production-deploy-profile.md`.

**Escalation:** `Elevated` is a rising-trend ticket, worth investigating
before it worsens. `Critical` means requests are visibly queuing behind
blocked JS execution — escalate per your organization's on-call process.

## Heap usage

**Symptom:** `AMCoreHeapApproachingLivenessCeiling` is firing (heap used above
90% of the 1.5GiB liveness threshold for 5m).

**Likely causes, ranked:**

1. A genuine memory leak (a cache, listener, or subscription that never
   releases).
2. Sustained high load pushing heap usage up without a leak (check whether it
   plateaus or keeps climbing).
3. `HEALTH_MEMORY_HEAP_BYTES` was lowered without updating this alert's
   threshold to match (a fork-configuration drift, not a real production
   issue) — see the alert's own comment in `amcore-alerts.yml`.

**Diagnostic steps:**

1. Open the **"Heap used"** dashboard panel (Node runtime row) and look at the
   shape: a leak raises the post-GC baseline across process lifetime and
   resets on restart; load-driven usage tracks the **"Request rate by route"**
   panel and falls back down when traffic does.
2. If the pattern looks like a leak, the next diagnostic step is a heap
   snapshot / profiler session against the running process — outside the
   scope of this metrics-only guide.

**Mitigation:**

- If load-driven and the ceiling is genuinely too low for real traffic: raise
  `HEALTH_MEMORY_HEAP_BYTES` deliberately and update this alert's threshold
  (`0.9 * <new bytes>`) to match in the same change — the two must stay in
  sync since the env var cannot be read from PromQL.
- If leak-shaped: this is a code-level fix, not an operational mitigation;
  a rolling restart buys time but does not resolve the underlying leak. An
  orchestrator restarts it automatically only if `/health/live` is configured
  as a liveness probe; the shipped Compose healthcheck uses `/health/ready`
  and does not restart a merely unhealthy container.

**Escalation:** this is `severity: page` — a configured liveness probe may
restart the process. Escalate per your organization's on-call process if a
restart alone doesn't stabilize heap usage on the next occurrence.

## File descriptors

**Symptom:** `AMCoreFileDescriptorsApproachingLimit` is firing (open FDs above
90% of the process ulimit for 5m). Linux-only — `prom-client` returns no
`process_open_fds`/`process_max_fds` off-Linux (e.g. a macOS dev host), so
this alert is never evaluable there and only becomes live in Docker/Linux.

**Likely causes, ranked:**

1. A leak of realtime SSE connections (clients that disconnected without the
   server observing the close).
2. A leak of DB or Redis sockets (a pool not releasing connections back).
3. The process ulimit itself is set too low for real concurrent load.

**Diagnostic steps:**

1. Open the **"Open file descriptors ratio (Linux only)"** dashboard panel
   (Node runtime row) to confirm the trend.
2. Check realtime connection gauges against the SSE-specific queries in
   [`realtime.md`](realtime.md) — a stuck-open SSE stream that the server
   thinks is still active is a common source of FD growth that never shows up
   as an HTTP or queue symptom.
3. Check the **"Pool connections"** panel (Database row) for a DB pool that
   isn't releasing.

**Mitigation:**

- If SSE-related: identify and fix the leak per [`realtime.md`](realtime.md);
  a process restart clears the immediate FD pressure but not the underlying
  leak.
- If the ulimit is simply too low for legitimate concurrent load, raise it at
  the container/orchestrator level (this is infrastructure configuration, not
  an application setting).

**Escalation:** this is `severity: page` — realtime SSE connections and
DB/Redis sockets each consume one FD, so this can cascade into both realtime
and DB/Redis symptoms if not addressed. Escalate per your organization's
on-call process.
