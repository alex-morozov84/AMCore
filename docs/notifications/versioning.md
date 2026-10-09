# Notification versions and replay

Register each supported `(type, schemaVersion)` in
[`definitions/index.ts`](../../apps/api/src/core/notifications/definitions/index.ts):

```ts
export const NOTIFICATION_DEFINITIONS = [
  { definition: profileUpdatedV1, current: false },
  { definition: profileUpdatedV2, current: true },
]
```

Exactly one registration per type must be `current: true`. Duplicate versions,
multiple current registrations, and a type without a current registration refuse
startup. New occurrences use the current version. Retained versions supply their
own payload normalization, first-party action, classification, projection and
renderers. Keep these functions deterministic: no current time, database lookup,
network call or preference lookup inside normalization/rendering.

## Replaying an occurrence

An occurrence is identified by `(recipientUserId, idempotencyKey)`. Reusing that
key looks up the existing notification **before** current-version normalization.
The producer normalizes the caller's payload and action using the stored version
and compares its immutable fingerprint. A matching occurrence returns
`created: false`; a different occurrence throws
`NotificationIdempotencyConflictError`.

This also applies when a concurrent insertion wins after the first lookup. The
loser re-reads the winner and compares using the winner's version. Deploying v2
therefore does not automatically make a v1 producer retry conflict. A payload
that the historical schema cannot normalize, or a different normalized payload,
action, type, organization or supplied occurrence time, still conflicts. A
removed historical definition cannot supply a replacement current definition.

Replay preserves the original delivery rows: channels, locale, target keys,
generation references, destination projection and preferences are not recomputed.
A newly linked subscription is eligible only for a new occurrence.

## Transactional batches

Call `notifyTx(tx, input)` for each recipient inside one caller-owned Prisma
transaction. Existing recipients can replay v1 while new recipients use v2.
Let any conflict escape the callback so the **whole batch and business mutation**
roll back. Do not catch a producer conflict and commit a partial business batch.
The supported isolation level is PostgreSQL `READ COMMITTED`; stronger isolation
can require retrying the whole business transaction after serialization failure.

Readers use the supplied transaction. Acquire recipient/domain locks in a stable
order before delivery locks; do not pre-lock deliveries and then enter a channel
reader. `notifyTx` does not enqueue a wake or publish an SSE hint before commit;
the recovery poller discovers committed external work and clients refetch.

## Rendering and retirement

Feed rendering resolves the stored version. Unknown versions, malformed payloads
and a throwing renderer produce a neutral item for that row. External rendering
refuses an unavailable historical version rather than using current content.
Detailed external renderers receive only `projectExternal(channel, payload)` and
are registered under `renderExternal[channelId]`.

Retirement requires a data check proving that no retained notifications or active
external deliveries reference the version. Age alone is insufficient: retention
preserves active deliveries even beyond ordinary read/unread retention windows.
Keep the decoder until all referencing work and retained feed history are gone.
A maintenance conversion must explicitly preserve occurrence/target evidence;
changing a decoder in place is not a migration.

## Prepared external requests

Before the first provider call, the worker freezes a private versioned request
under the owned, unexpired delivery lease. It includes the exact JSON body string,
method/path, notification version, target identity, logical transport binding and
stable idempotency key. Later attempts validate and reuse that request without
rendering or serializing it again. A partial snapshot, wrong hash, incompatible
wire version, changed binding or substituted destination refuses delivery.

Credentials, authorization headers and abort signals are resolved at actual
start and are never stored in the snapshot. Snapshots must contain only bounded,
policy-projected non-secret content. They are excluded from feed, Console,
Bull Board, audit, metrics and logs. The actual-start lease/target fence still
runs after preparation; freezing a request does not grant permission to send it.

Resend requests use `notification-delivery:<deliveryId>` and retain the same body
across retries. Provider deduplication lasts 24 hours; it does not create an
unlimited exactly-once guarantee. Telegram has no equivalent provider key and
retains at-least-once duplicate risk. See [delivery guarantees](README.md#delivery-guarantees-and-operating-limits)
and the [maintenance upgrade](../operations/deployment.md).

Executable examples and race assertions are in
[`notification-extension-contracts.e2e-spec.ts`](../../apps/api/test/notification-extension-contracts.e2e-spec.ts)
and [`notification-prepared-request.e2e-spec.ts`](../../apps/api/test/notification-prepared-request.e2e-spec.ts).
