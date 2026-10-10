# Queue infrastructure (BullMQ)

Background work uses one code-owned registration. Start with the
[backend registration and policy guide](../../../../../docs/backend/background-work.md)
for compiled ordinary image and durable database-owned recipes.

## Adding a queue

Define a work with versioned Zod job schemas, a safe diagnostic projection,
retention and replay policy. Export its typed producer, worker handlers and lazy
registration modules. Add that registration once to the application registry.
The framework creates the queue and managed host, starts it only after readiness,
and provides shared read/control adapters. Do not add a second inventory entry,
raw `@Processor`, custom administration controller or UI.

Choose business idempotency for ordinary replayable jobs. Use the approved
provider-window recipe for queued email. Durable work retains its database
business authority and implements the common transactional adapter. Real
notification/AI domain control adapters are separate extensions.

The default queue has no business handler until a product registers one. The
existing notification/AI queues carry wake hints; their database pollers retain
business recovery ownership.

## Producing work

Inject the definition's producer token and call `producer.add(jobName, payload,
options)`. The producer validates the declared schema, writes a managed envelope
with a fresh incarnation and returns `{jobId, incarnation}`. A duplicate retained
job ID returns the stored incarnation instead of replacing its payload.

The compatibility `QueueService.add` delegates to the same producer and returns
the same identity. Its public options are limited to `jobId`, `delay`, `priority`
and `attempts`; retention/backoff/system metadata are framework-owned. Automatic
attempts are finite (1–10). Priority0/unset runs in the normal lane; lower positive
priorities run before higher positive priorities. Delay is bounded at30 days.

Do not use raw queue retry/remove/pause methods for operator controls. The shared
control surface applies bounded eligibility, revisions, confirmations, strict
intent/audit/receipt and policy-specific safety. Unknown administrative commands
are never redispatched. Business replay is governed separately by the policy.

## Bull Board dashboard

Bull Board is always read-only. The backend serves `/api/v1/admin/queues` for
privileged operators on web/all roles, never worker. Production requires explicit
`ENABLE_BULL_BOARD=true` in the process environment before startup. A reverse
proxy must not cache this surface. Enabling it grants no mutation capability.
Safe projections exclude recipients, bodies, raw payloads, provider failures and
stack traces. Secret-bearing email must never be queued in the first place.

<!-- AMCORE_CONSOLE_QUEUE_GUIDE_START -->

With Operations Console enabled, registered work appears automatically in its
native Background work panel. Use its captured confirmations and receipts for
permitted actions; use Board only for read-only inspection. See the
[operator guide](../../../../../docs/operations-console/background-work.md).

<!-- AMCORE_CONSOLE_QUEUE_GUIDE_END -->

## Worker roles and outages

Run `PROCESS_ROLE=worker` independently from web/API replicas, or use `all` for a
single-process deployment. Registration loads business handlers only in worker/all
roles; managed hosts remain stopped until infrastructure and policy readiness.

Producer failures propagate to callers. A business mutation already committed
must decide explicitly whether an optional queue hint is best-effort; durable
business recovery remains its poller's responsibility. Secret email uses direct
send rather than the queue. PG provider safety and audit are required before
possible queued effects; broker outage prevents broker admission.

Producer Redis failures emit `queue.redis_error`; reconnects emit
`queue.redis_reconnecting`. Registered email worker hooks emit
`queue.worker_error` and terminal `email.job.dead_letter`, without logging payloads
or provider exception text. Inspect worker readiness and queue state before
retrying. A missing broker hash or failed job is not provider outcome evidence.
See [queued email safety](../../../../../docs/email/queued-safety.md) for immutable
requests, finite starts, certainty, clocks and protected evidence recovery.

## Verification and extension

Run isolated API Testcontainers for actual claims, retry/stall/lost-ack and
transactional audit behavior. Compile the public recipes; schema-only tests do
not establish business idempotency. Console-disabled products retain this backend
registration/API/audit/worker recipe. Read `PROJECT_CONTEXT.md` before extending
a product, and do not recreate disabled frontend pages without owner instruction.
