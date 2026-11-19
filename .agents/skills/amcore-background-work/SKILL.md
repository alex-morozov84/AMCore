---
name: amcore-background-work
description: Add or change AMCore scheduled jobs, notification definitions or delivery, queue handlers, or database-owned background work. Excludes ordinary CRUD and incident handling.
---

# AMCore background work

Read `PROJECT_CONTEXT.md` and applicable checkout instructions.
Use the product's local guides and source, not upstream main as product policy.
Read the current owners again when continuing after a relevant guide change.

## Choose the business authority

Identify the requested result, stable business identity and actual side effect.

- For a timer such as nightly cleanup, read
  [scheduled jobs](../../../docs/backend/scheduled-jobs.md). Register it once
  through the timer catalogue and report an explicit result. Add a queue only
  if the task separately needs queued work with its own handling contract.
- For a notification, start with [notification definitions and production](../../../docs/notifications/README.md#add-a-notification-definition).
  Use the existing feed and delivery paths. In-app delivery needs no queue.
  External delivery uses the existing database-owned flow and its wake
  mechanism where applicable. A new notification type alone needs no new queue.
- For independently queued or database-owned work, read the
  [background-work contract](../../../docs/backend/background-work.md) and
  [queue entrypoint](../../../apps/api/src/infrastructure/queue/README.md)
  as applicable. Distinguish queue-owned jobs from database-owned work
  and wake hints. Ordinary module/HTTP wiring belongs to backend-module;
  authentication and authorization changes retain their own workflows.

## Connect queued or database-owned work

1. Follow the owning guide's ordinary or durable recipe. Keep production code
   in the product source graph; recipes demonstrate a contract, not a ready
   image decoder or storage pipeline. Register once through the existing
   composition; preserve producer/worker roles and readiness boundaries.
2. Define business deduplication that survives broker history removal, repeated
   requests and recycled job IDs. Broker identity and incarnation identify an
   execution; they do not establish that a business effect happened only once.
3. Keep stored wire versions and their supported handler bindings compatible.
   Use normalization for business shape changes; preserve the old wire contract.
   Read current limits/options from the guide rather than copying arbitrary
   BullMQ settings or mutating broker state directly.
4. For database-owned work, use the common reader/control boundary and business
   transaction for locks, eligibility and effects. An external provider call
   does not belong inside the administrative transaction adapter.
5. For external effects, choose the existing domain authority and its evidence
   before permitting a retry. Unknown or accepted outcomes do not become safe
   because a broker failed. A timeout does not prove remote cancellation.
   Do not create a new intent merely to bypass a protected old result.
6. Provide safe projections, current labels and bounded failure reasons. Do not
   expose payloads, credentials, provider text or raw exception messages.
   Console-disabled builds must retain the applicable API/worker behavior.

## Read conditional owners

- Native diagnostics, commands, receipts and unknown results:
  [Background work controls](../../../docs/operations-console/background-work.md).
  Keep captured identity/revision and policy; a missing reply is not permission
  to create a replacement command. The Board stays read-only.
- Queued email: [queued safety](../../../docs/email/queued-safety.md).
- Notification definitions, channels or delivery controls: start with
  [Notifications](../../../docs/notifications/README.md). Read [channel registration](../../../docs/notifications/channels.md)
  and [versioning](../../../docs/notifications/versioning.md) for extension work.
  Identify the occurrence, retained version, target and request that own replay.
  For retry or cancellation, read [delivery controls](../../../docs/notifications/control.md)
  and distinguish the automatic budget, possible external effect and manual grant.
  Use the deployment and integration owners for rollout and provider reachability.
  AI runs/tools: [runs](../../../docs/ai/runs.md). Preserve their own request,
  certainty and retry contracts; do not generalize ordinary-job guarantees.
- Registering external-service status/probes:
  [integrations](../../../docs/backend/integrations.md). Status registration is
  separate from work registration; a status read must not call the provider.
- Product images/files: read the current storage/media owners before choosing
  actual effects. The demonstration unique reference is not image processing.

## Check the changed guarantee

Select the smallest applicable current-guide checks for registration/roles,
wire compatibility, business deduplication, failure projection and effect safety.
Reuse applicable existing evidence; inherited fixture results do not certify a
new downstream handler's business behavior. Separate planning, code review,
executed examples/tests and observed skill use. Do not execute builds, services,
provider requests or controls without applicable authorization.

Report the authority, identities, version/role choices, safe retry/stop behavior,
current guides actually read, proposed or executed checks and exact gaps. If
code and guide conflict, stop the affected action and report the discrepancy.
