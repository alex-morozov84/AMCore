# Notifications

AMCore ships a reusable, per-user notification subsystem on its own
`notifications` Postgres schema. The starter exposes the in-app feed,
preferences, and a transaction-aware internal producer; external delivery
channels (email, Telegram) and realtime fan-out are additive later-arc work and
do not change the producer/feed/preferences contract documented here.

## What Is Included

| Area           | Built-in behavior                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence    | Own `notifications` Postgres schema: canonical `Notification`, per-target `NotificationDelivery`, immutable `NotificationDeliveryAttempt`, `NotificationPreference`.                           |
| Producer       | `NotificationsService.notify()` (owns its transaction) and `notifyTx(tx, …)` (joins the caller's). **No public create endpoint** — only trusted server code may create a notification.         |
| In-app channel | Inserted `DELIVERED` in the same database transaction as the canonical row, so the feed never depends on a background worker being healthy.                                                    |
| Idempotency    | Required namespaced key (`dotted.namespace:occurrence-id`) + payload fingerprint. Same key + same fingerprint = safe replay; same key + different fingerprint = stable conflict.               |
| Preferences    | Master toggle (`UserSettings.notificationsEnabled`) plus per-`(category, channel)` user override. Mandatory channels bypass the master toggle and are locked in the preferences read response. |
| Feed           | Cursor pagination by `(createdAt DESC, id DESC)`; no `total`. Unread count is a separate exact endpoint.                                                                                       |
| i18n           | Structured, language-agnostic payload in the database. `title` / `body` are rendered server-side in the recipient's current `User.locale` at feed read time, never stored as text.             |
| Capabilities   | `GET /notifications/capabilities` lists only currently active channels and per-category support — no dead enum value is advertised.                                                            |
| Tests          | Unit + Testcontainers e2e cover the producer, feed, preferences, cursor under concurrent insert, transactional rollback, and idempotency replay/conflict.                                      |

## Mental Model

```
Trusted backend module (security event, profile change, etc.)
  └── NotificationsService.notify(input)            // owns its transaction
      or NotificationsService.notifyTx(tx, input)   // writes on caller's transaction
            validate definition + payload + idempotency key
            resolve preferences + channels + recipient locale
            INSERT Notification (canonical) + DELIVERED in_app delivery   [one transaction]

HTTP (bearer, recipient-scoped) — feed, mark/archive, preferences, capabilities, master toggle
```

There is **no public create endpoint**. Notifications are produced exclusively
by trusted server code: a bearer user cannot manufacture a `type`, payload,
recipient, or delivery channel. The HTTP surface is read/update only.

## Channel Scope

| Channel    | Status                                  | Where                                                                                                                                                         |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `in_app`   | **Shipped**, synchronous-in-transaction | Today.                                                                                                                                                        |
| `email`    | Planned                                 | Worker-only adapter over [`EmailService.send()`](../../apps/api/src/infrastructure/email/) with a stable provider idempotency key.                            |
| `telegram` | Planned                                 | Direct Bot API client, hashed one-time `/start` link tokens, dedicated webhook verifier on top of [`docs/operations/webhooks.md`](../operations/webhooks.md). |
| `web_push` | Deferred to the frontend phase          | Backend, service worker, VAPID config, and browser permission UX ship together.                                                                               |

The durable model already reserves the dispatcher's lease/retry/attempt columns
so adding a worker-driven channel is purely additive — no claim-mechanism or
state-machine migration is required.

## HTTP API

All endpoints are bearer-authenticated and scoped to the caller. Every response
schema is typed via `@ZodResponse`; the OpenAPI completeness test in
[`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts)
fails CI if a new handler ships without one (or with the wrong status).

| Method  | Path                          | Description                                                                                                          |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/notifications`              | Cursor-paginated feed. Query: `?cursor=&limit=`. Body: `{ data, nextCursor, hasMore }`. Excludes archived.           |
| `GET`   | `/notifications/unread-count` | `{ unread }`. Excludes read **and** archived.                                                                        |
| `POST`  | `/notifications/read-all`     | `{ updated: N }`. Idempotent; archived rows are never marked read.                                                   |
| `POST`  | `/notifications/:id/read`     | `204`. Idempotent; a foreign or non-existent id is a recipient-scoped no-op (no information leak).                   |
| `POST`  | `/notifications/:id/archive`  | `204`. Idempotent; archived rows drop out of feed and unread count.                                                  |
| `GET`   | `/notifications/capabilities` | Active channels and per-category supported / overridable channels.                                                   |
| `GET`   | `/notifications/preferences`  | `{ notificationsEnabled, preferences: [{ category, channel, enabled, mandatory }] }`.                                |
| `PUT`   | `/notifications/preferences`  | `204`. Upsert one `(category, channel)` override. `400` for unknown pair or a channel mandatory across the category. |
| `PATCH` | `/notifications/settings`     | `204`. Master toggle write (`{ notificationsEnabled: boolean }`).                                                    |

Cursor pagination is the documented endpoint-local exception to the project's
default offset envelope — the feed is append-heavy and offset semantics would
yield duplicates/skips when new rows arrive between page requests.

## Preferences Resolution

When the producer resolves which channels deliver a given notification, the
order is **top wins**:

1. The definition's `mandatoryChannels` — always on, never disabled by user
   preference, and locked in the `GET /notifications/preferences` response.
2. The master toggle (`UserSettings.notificationsEnabled`) — gates **all
   optional** channels. Mandatory channels are unaffected.
3. The explicit stored user override `(category, channel)`.
4. The definition's default.

In the read response:

- `enabled: null` means **no user override is stored** — the definition default
  applies.
- `mandatory: true` means at least one definition in the category forces this
  channel; the override cannot disable it and a `PUT` is rejected.

The starter ships one informational definition (`account.profile_updated`,
in-app only), so the only meaningful preference today is the master toggle.
The resolver is exercised end-to-end as soon as a fork adds a definition with a
mandatory or externally-defaulted channel.

## Adding a Notification Definition

A definition is a code-owned record: identifier, payload schema, default and
mandatory channels, content classification, and the localized `renderInApp`.
Live definitions live in
[`apps/api/src/core/notifications/definitions/`](../../apps/api/src/core/notifications/definitions/).

```ts
// apps/api/src/core/notifications/definitions/your-event.definition.ts
import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

// Allowlisted, bounded payload — durable rows, queues, logs, and renderers
// all see this shape, so keep it small and predictable.
const payloadSchema = z.object({
  updatedFields: z.array(z.enum(['name', 'email', 'locale'])).min(1),
})
type Payload = z.infer<typeof payloadSchema>

export const yourEventDefinition: NotificationDefinition<Payload> = {
  type: 'your_area.your_event',
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  supportedChannels: [NotificationChannel.IN_APP],
  defaultChannels: [NotificationChannel.IN_APP],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema,
  safePayload: (p) => ({ updatedFields: p.updatedFields }),
  renderInApp: (p, locale) =>
    locale === 'en'
      ? { title: 'Your event', body: `${p.updatedFields.length} field(s) changed.` }
      : { title: 'Ваше событие', body: `Изменено полей: ${p.updatedFields.length}.` },
}
```

Register it in
[`apps/api/src/core/notifications/definitions/index.ts`](../../apps/api/src/core/notifications/definitions/index.ts).
The registry rejects duplicate `type`s at bootstrap, so a misconfiguration
fails fast on startup, not at send time.

### Payload migration rule

Changing the durable `payload` shape requires **bumping `schemaVersion` AND
keeping a renderer for older versions** within your retention window —
historical rows in the feed must still render. An unknown `type`, an
unsupported `schemaVersion`, an invalid stored payload, or a throwing renderer
all fall back to a **neutral feed item per row**, never failing the whole feed
page.

## Producing a Notification

Inject `NotificationsService`. Use the variant that matches the caller's
transaction story (mirrors the existing `AuditLogService.record({ tx })`
precedent):

```ts
constructor(private readonly notifications: NotificationsService) {}

// Free-standing: the notification is informational and the business write
// has already committed (or is independent).
await this.notifications.notify({
  recipientUserId: user.id,
  type: 'your_area.your_event',
  payload: { updatedFields: ['name'] },
  idempotencyKey: `your_area.your_event:${eventId}`,
})

// Atomic with a business mutation: the notification rolls back if the
// outer transaction does.
await this.prisma.$transaction(async (tx) => {
  await tx.thing.update({ /* ... */ })
  await this.notifications.notifyTx(tx, {
    recipientUserId: user.id,
    type: 'your_area.your_event',
    payload: { updatedFields: ['name'] },
    idempotencyKey: `your_area.your_event:${eventId}`,
  })
})
```

Use `notifyTx` whenever the notification is semantically part of the mutation
(security state changes, payments, organization transitions). Use `notify` for
derived events that are not part of the business invariant.

### Idempotency

`idempotencyKey` is **required** and follows the grammar
`dotted.namespace:occurrence-id` (e.g. `account.password_changed:<sessionId>`,
never a bare `password-changed`). The producer fingerprints the immutable
dedupe intent (`type` + `schemaVersion` + `category` + `payload` + `action` +
`organizationId` + `occurredAt`) and stores it next to the key.

On retry:

- **Same key + matching fingerprint** → the existing row is returned
  (`created: false`); no duplicate is written.
- **Same key + different fingerprint** → `NotificationIdempotencyConflictError`
  (a caller bug, not a safe replay).

The check is atomic — implemented as `INSERT … ON CONFLICT DO NOTHING
RETURNING`, so a conflict never aborts the caller's transaction when using
`notifyTx`.

## Content Sensitivity (Forward-Looking)

Each definition declares a `contentClass` (`PUBLIC | PERSONAL | SENSITIVE`)
and a per-channel `externalModeByChannel`
(`detailed | generic | forbidden`). In the in-app-only starter the
classification has no externally-visible effect, but it is the contract
external adapters will read once they ship — `SENSITIVE` definitions default to
a neutral summary on email/Telegram instead of the full payload.

Secrets (password-reset tokens, verification tokens, credentials) are
**forbidden** in the notifications subsystem entirely; they remain in the
existing direct-email paths and must never appear in a `Notification.payload`,
a queue job, or a delivery attempt log.

## What's Not in the Starter Yet

These are intentional later-arc deliveries — additive over the
producer/feed/preferences contract, not gaps in the current scope:

- **External-channel dispatch** — worker-driven BullMQ wake jobs, durable retry
  schedule in Postgres, lease/CAS claim mechanism, immutable attempt history,
  retention cleanup. The durable schema reserves the columns; no dispatcher
  runs yet.
- **Email channel** — synchronous in-process adapter over `EmailService.send()`
  with a stable provider idempotency key
  (`notification-delivery:<deliveryId>`). Never enqueues the existing email
  queue from inside the notification subsystem.
- **Telegram channel** — direct Bot API client (no framework dependency),
  one-time hashed `/start` link tokens, durable `update_id` deduplication, and
  a dedicated `X-Telegram-Bot-Api-Secret-Token` constant-time verifier on top
  of [`docs/operations/webhooks.md`](../operations/webhooks.md).
- **Realtime fan-out** — SSE delivery with a dedicated Redis Pub/Sub
  subscriber per replica, environment-namespaced events, no sticky sessions,
  at-most-once semantics (the durable feed and reconnect refetch are the
  recovery path).
- **Web Push** — deferred to the frontend phase; the backend channel and the
  client service worker / browser permission UX ship together.
- **Organization recipients and policy** — organization fan-out, org-level
  preferences, and a direct shared organization inbox are out of scope for the
  user-recipient v1.
- **Digests / batching, quiet hours, timezone scheduling, frequency caps** —
  triggered when a product requirement defines them; they extend the resolver,
  scheduling, and batch contracts above.

## Tests

| Surface                                                                                                                                                                                                                                                                                                                                  | Where                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition registry, payload validation, safe projection, preference resolution, idempotency fingerprint, cursor codec, in-app render, producer behavior                                                                                                                                                                                 | Unit specs alongside the module under [`apps/api/src/core/notifications/`](../../apps/api/src/core/notifications/)                                                         |
| Feed auth/isolation + DESC order + locale render, unread count, mark/archive (idempotent, recipient-scoped), capabilities, preferences read + upsert + unknown-pair / malformed reject, master toggle PATCH, cursor under concurrent insert, `notifyTx` rollback atomicity, same-key dup-fingerprint match / mismatch, OpenAPI inventory | [`apps/api/test/notifications.e2e-spec.ts`](../../apps/api/test/notifications.e2e-spec.ts), [`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts) |

E2E uses real PostgreSQL + Redis via Testcontainers; no infrastructure is
mocked. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for run commands.

## See Also

- Backend architecture & conventions — [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md)
- Webhook verification primitive (used by the future Telegram channel) — [`docs/operations/webhooks.md`](../operations/webhooks.md)
- Email infrastructure (the future email channel's underlying provider) — [`apps/api/src/infrastructure/email/`](../../apps/api/src/infrastructure/email/)
- Queue infrastructure (the future dispatcher's wake/execution path) — [`apps/api/src/infrastructure/queue/README.md`](../../apps/api/src/infrastructure/queue/README.md)
- HTTP idempotency (separate primitive, not used by the producer's own dedupe) — [`docs/operations/idempotency.md`](../operations/idempotency.md)
