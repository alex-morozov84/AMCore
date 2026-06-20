# Notifications

AMCore ships a reusable, per-user notification subsystem on its own
`notifications` Postgres schema. The starter exposes the in-app feed,
preferences, a transaction-aware internal producer, and a durable worker-driven
**email** channel (Postgres-owned retry, leases, immutable attempt history, and
retention). The remaining external channels (Telegram) and realtime fan-out are
additive later-arc work and do not change the producer/feed/preferences contract
documented here.

## What Is Included

| Area              | Built-in behavior                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence       | Own `notifications` Postgres schema: canonical `Notification`, per-target `NotificationDelivery`, immutable `NotificationDeliveryAttempt`, `NotificationPreference`.                                                                                              |
| Producer          | `NotificationsService.notify()` (owns its transaction) and `notifyTx(tx, …)` (joins the caller's). **No public create endpoint** — only trusted server code may create a notification.                                                                            |
| In-app channel    | Inserted `DELIVERED` in the same database transaction as the canonical row, so the feed never depends on a background worker being healthy.                                                                                                                       |
| External dispatch | Worker-only dispatcher (ADR-052): a BullMQ wake job and a `FOR UPDATE SKIP LOCKED` recovery `@Cron` drain due `PENDING` deliveries; Postgres owns the retry schedule, leases, and immutable attempts. A lost wake (or `notifyTx`) is still drained by the poller. |
| Email channel     | Worker-only adapter over `EmailService.send()` (never the email queue) with a stable provider idempotency key `notification-delivery:<id>`. Verified-destination only.                                                                                            |
| Retention         | Daily worker-only sweep: archived −30d, read −90d, unread −180d, finished attempts −30d. Never deletes a notification with an active external delivery.                                                                                                           |
| Idempotency       | Required namespaced key (`dotted.namespace:occurrence-id`) + payload fingerprint. Same key + same fingerprint = safe replay; same key + different fingerprint = stable conflict.                                                                                  |
| Preferences       | Master toggle (`UserSettings.notificationsEnabled`) plus per-`(category, channel)` user override. Mandatory channels bypass the master toggle and are locked in the preferences read response.                                                                    |
| Feed              | Cursor pagination by `(createdAt DESC, id DESC)`; no `total`. Unread count is a separate exact endpoint.                                                                                                                                                          |
| i18n              | Structured, language-agnostic payload in the database. `title` / `body` are rendered server-side in the recipient's current `User.locale` at feed read time, never stored as text.                                                                                |
| Capabilities      | `GET /notifications/capabilities` lists only currently active channels and per-category support — no dead enum value is advertised.                                                                                                                               |
| Tests             | Unit + Testcontainers e2e cover the producer, feed, preferences, cursor under concurrent insert, transactional rollback, and idempotency replay/conflict.                                                                                                         |

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
| `email`    | **Shipped**, worker-driven durable      | Worker-only adapter over [`EmailService.send()`](../../apps/api/src/infrastructure/email/) with a stable provider idempotency key; verified-destination only. |
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
| `GET`   | `/notifications/stream`       | `text/event-stream`. Realtime feed-change hints (SSE) — see [Realtime stream](#realtime-stream-sse) below.           |

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

The starter ships two definitions: `account.profile_updated` (informational,
in-app only) and `account.password_changed` (security; in-app **and** email,
both mandatory). The latter exercises the resolver end-to-end — its email and
in-app deliveries are locked on in the preferences response and a `PUT` that
tries to disable either is rejected `400`.

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

## External Delivery, Retry, and Recovery

External deliveries (email today) are durable and worker-driven (ADR-052).
`notify()` writes one `PENDING` `NotificationDelivery` per resolved external
target in the producer transaction, then best-effort enqueues a BullMQ **wake
job** (`notifications` queue, `attempts: 1`) after commit. `notifyTx` writes the
same rows but enqueues nothing — the caller owns commit timing.

The worker drains due deliveries with a `FOR UPDATE SKIP LOCKED` claim, so the
wake job and a recovery `@Cron` (every 30s, on **every** replica, deliberately
**not** singleton-locked) are both safe and de-duplicated by the database:

- **Postgres owns retry**, not BullMQ. A claim leases the row (`PROCESSING`,
  2-min TTL), bumps `attemptCount`, and inserts an in-flight attempt. The
  provider call runs outside any transaction, bounded by a 10s timeout.
- **Finalize is a CAS** on `(id, status=PROCESSING, leaseToken)` plus the attempt
  close, in one transaction — a stale lease holder can never overwrite newer
  state, and a crash can't leave a delivered row with an open attempt.
- **Transient** failure → `RETRY_SCHEDULED` with exponential backoff
  (`30s → 60s → 120s → 240s`, cap 15 min, ±20% jitter) until `maxAttempts` (5),
  then terminal `FAILED` (dead-lettered). **Permanent** failure → terminal
  `FAILED` immediately (also dead-lettered).
- A **crashed worker's** expired lease is reclaimed by the reaper: the open
  attempt is marked `ABANDONED` and the delivery is rescheduled (or failed if the
  budget is exhausted).
- A **lost wake** (Redis outage on enqueue) or a `notifyTx` delivery is still
  found by the recovery poller — at-least-once with provider-side idempotency.

### Email channel

The email adapter (worker-only) renders via the definition and calls
[`EmailService.send()`](../../apps/api/src/infrastructure/email/) directly with a
stable idempotency key `notification-delivery:<deliveryId>` — it **never**
enqueues the email queue (secret-bearing/transactional emails keep their own
direct paths). Email goes to a **verified destination only**: if the recipient's
account email is unverified, the email delivery is recorded `SKIPPED`
(`destination_unverified`), never `PENDING` — the mandatory in-app delivery still
guarantees the user sees the event. Mail is sent to the produce-time canonical
verified address snapshot (`targetKey`), not necessarily the display-form
address.

A successful **password reset** promotes `User.emailVerified = true` in the reset
transaction (the single-use token, delivered to and returned from the account
mailbox, proves control of it — OWASP/NIST), so the post-reset
`account.password_changed` alert is always deliverable by email.

### Retention

A daily worker-only `@Cron` (singleton-locked; a skipped run self-repairs next
night) batch-deletes aged rows: archived −30d, read −90d, unread −180d, finished
attempts −30d. It never deletes a notification that still has an active
(`PENDING`/`PROCESSING`/`RETRY_SCHEDULED`) external delivery. The feed is **not**
an audit log — durable security events live in `AuditLog` (ADR-045).

## Content Sensitivity

Each definition declares a `contentClass` (`PUBLIC | PERSONAL | SENSITIVE`) and a
per-channel `externalModeByChannel` (`detailed | generic | forbidden`). On an
external channel resolved to `detailed`, the adapter renders **only** the
definition's `projectExternal(channel, payload)` allowlisted projection via
`renderEmail` — never the raw payload. `PERSONAL`/`SENSITIVE` default to a neutral
generic summary + a safe first-party action; a definition may explicitly override
a channel to `detailed` (as `account.password_changed` does for email, projecting
only the non-secret change time).

Secrets (password-reset tokens, verification tokens, credentials) are
**forbidden** in the notifications subsystem entirely (`SECRET` content is
rejected at registration); they remain in the existing direct-email paths and
must never appear in a `Notification.payload`, a queue job, or a delivery attempt
log.

## Realtime stream (SSE)

`GET /notifications/stream` is a bearer-authenticated [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream that pushes a **content-free hint** whenever the recipient's feed changes
(create / read / mark-all-read / archive). It exists so a client can refresh
without polling; it is **not** a delivery channel. Postgres remains the source of
truth — every event simply means _"refetch the feed and unread count"_.

How it works (ADR-053): each web replica runs one dedicated Redis Pub/Sub
subscriber on an environment- and version-namespaced channel; a hint published
after a committed change fans out to every replica, and each routes it to that
user's locally-held streams (a process-local hub). There are **no sticky
sessions** and **at-most-once** semantics — a hint dropped during a Redis blip is
recovered by the next reconnect refetch, never replayed.

**Event payload** (`data:` only; no `id:`/`event:` wire fields, so no
`Last-Event-ID` replay):

```jsonc
{ "eventId": "…", "reason": "created" | "read" | "archived" | "unread_changed", "notificationId": "…?" }
```

`eventId` is for client-side dedupe/correlation only; `notificationId` is present
for item-scoped reasons and absent for aggregate ones (e.g. `unread_changed`).
The reason is telemetry/optimization metadata — treat **every** event as "refetch".

**Client contract** (no JS client ships in the starter — `apps/web` is a stub):

- **Use a fetch-stream reader, not the `EventSource` API.** `EventSource` cannot
  set an `Authorization` header, and the token must **never** go in the URL/query
  (it would leak into logs/proxies) — send `Authorization: Bearer <accessToken>`.
- **On (re)connect, establish the stream first, _then_ refetch** the feed + unread
  count. This closes the subscribe-vs-snapshot race (a change between your snapshot
  and your subscription would otherwise be missed).
- **Reconnect with jittered exponential backoff.** The stream closes at access-token
  expiry (bounded by a server cap) — refresh the token and reconnect.
- **Treat a heartbeat timeout > the server interval as a dead connection** and
  reconnect; the server sends `:`-comment heartbeats (default every 20s).
- A Redis outage degrades realtime to "updates appear on your next refetch"; the
  feed is always correct without it.

**Limits & failure modes:** the per-user stream cap returns **429**, the global
per-process cap returns **503** (both before any stream bytes). Network/IP rate
limiting is delegated to a trusted ingress (the app does not trust
`X-Forwarded-For`). Overflowing a slow consumer's write buffer disconnects it so
it reconnects and resyncs. Operators tune the stream via the
`NOTIFICATIONS_REALTIME_*` env vars (see [`.env.example`](../../.env.example));
**deployments that share one Redis must set a distinct
`NOTIFICATIONS_REALTIME_NAMESPACE`** per environment, or their channels collide.
Proxy/buffering/HTTP-2 guidance is in
[`docs/operations/deployment.md`](../operations/deployment.md).

## What's Not in the Starter Yet

These are intentional later-arc deliveries — additive over the
producer/feed/preferences/dispatch contract, not gaps in the current scope:

- **Telegram channel** — direct Bot API client (no framework dependency),
  one-time hashed `/start` link tokens, durable `update_id` deduplication, and
  a dedicated `X-Telegram-Bot-Api-Secret-Token` constant-time verifier on top
  of [`docs/operations/webhooks.md`](../operations/webhooks.md).
- **Web Push** — deferred to the frontend phase; the backend channel and the
  client service worker / browser permission UX ship together.
- **Organization recipients and policy** — organization fan-out, org-level
  preferences, and a direct shared organization inbox are out of scope for the
  user-recipient v1.
- **Digests / batching, quiet hours, timezone scheduling, frequency caps** —
  triggered when a product requirement defines them; they extend the resolver,
  scheduling, and batch contracts above.

## Tests

| Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Where                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Definition registry, payload validation, safe projection, preference resolution, idempotency fingerprint, cursor codec, in-app render, producer behavior                                                                                                                                                                                                                                                                                                                                    | Unit specs alongside the module under [`apps/api/src/core/notifications/`](../../apps/api/src/core/notifications/)                                                                                     |
| Feed auth/isolation + DESC order + locale render, unread count, mark/archive (idempotent, recipient-scoped), capabilities, preferences read + upsert + unknown-pair / malformed reject, mandatory-channel reject, master toggle PATCH, cursor under concurrent insert, `notifyTx` rollback atomicity, same-key dup-fingerprint match / mismatch, password-reset → `emailVerified` promotion + email delivery materialization, retention by-state + active-delivery guard, OpenAPI inventory | [`apps/api/test/notifications.e2e-spec.ts`](../../apps/api/test/notifications.e2e-spec.ts), [`apps/api/test/openapi.e2e-spec.ts`](../../apps/api/test/openapi.e2e-spec.ts)                             |
| Durable dispatcher against real Postgres: `FOR UPDATE SKIP LOCKED` disjoint claim, stale-holder CAS rejection, transient/permanent/exhausted attempt history, expired-lease reaper, recovery poller drains a wake-less committed delivery                                                                                                                                                                                                                                                   | [`apps/api/test/notification-dispatch.e2e-spec.ts`](../../apps/api/test/notification-dispatch.e2e-spec.ts)                                                                                             |
| Realtime SSE fan-out across **two web app contexts** on one Redis+Postgres: a real `notify()` committed on A and a worker-equivalent direct publish both reach the recipient's stream on B, per-user isolation, bearer required (no URL token), exact streaming headers; plus role composition (publisher every role; subscriber/hub/route web+all only)                                                                                                                                    | [`apps/api/test/notifications-realtime.e2e-spec.ts`](../../apps/api/test/notifications-realtime.e2e-spec.ts), [`apps/api/test/process-role.e2e-spec.ts`](../../apps/api/test/process-role.e2e-spec.ts) |

E2E uses real PostgreSQL + Redis via Testcontainers; no infrastructure is
mocked. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for run commands.

## See Also

- Backend architecture & conventions — [`docs/backend/architecture-and-conventions.md`](../backend/architecture-and-conventions.md)
- Webhook verification primitive (used by the future Telegram channel) — [`docs/operations/webhooks.md`](../operations/webhooks.md)
- Email infrastructure (the email channel's underlying provider) — [`apps/api/src/infrastructure/email/`](../../apps/api/src/infrastructure/email/)
- Queue infrastructure (the dispatcher's wake/execution path) — [`apps/api/src/infrastructure/queue/README.md`](../../apps/api/src/infrastructure/queue/README.md)
- HTTP idempotency (separate primitive, not used by the producer's own dedupe) — [`docs/operations/idempotency.md`](../operations/idempotency.md)
