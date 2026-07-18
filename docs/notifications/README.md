# Notifications

AMCore ships a reusable, per-user notification subsystem on its own
`notifications` Postgres schema: an **in-app feed**, per-user **preferences**
with mandatory channels, a transaction-aware **producer**, durable worker-driven
**email** and **Telegram** channels, and a realtime **SSE** fan-out. External
channels and realtime are purely additive over the producer/feed/preferences
contract — Web Push is future work.

Endpoint shapes (paths, bodies, status codes) live in the Swagger/OpenAPI
document at `/docs` in development — the source of truth. This guide covers the
model, the extension points, and the invariants OpenAPI does not express.

## When to use this vs EmailService

Use `NotificationsService` when the event belongs in the notification feed, must
respect user preferences / mandatory channels, or needs Postgres-owned retry and
attempt history. Use [`EmailService`](../email/README.md) for transactional email
infrastructure (secret-bearing links, queued non-secret mail). The notification
**email channel** is built _on top of_ `EmailService.send()` — see
[Delivery](#how-delivery-works).

## What it provides

- **In-app feed** — cursor-paginated (`createdAt DESC, id DESC`), plus an exact
  unread count. Inserted `DELIVERED` in the same transaction as the notification,
  so the feed never depends on a healthy worker.
- **Preferences** — a per-user master toggle plus per-`(category, channel)`
  overrides; **mandatory channels** bypass the toggle and cannot be disabled.
- **Producer** — trusted server code calls `notify()` / `notifyTx()`. There is
  **no public create endpoint**; a bearer user cannot manufacture a type,
  payload, recipient, or channel. The HTTP surface is read/update only.
- **Durable external channels** — email and Telegram, worker-driven, with
  Postgres-owned retry, leases, immutable attempt history, and retention.
- **Realtime** — a bearer-authenticated SSE stream of content-free "refetch"
  hints, fanned out across replicas via Redis Pub/Sub.
- **Language-neutral payloads** — the database stores a structured, bounded
  payload; `title` / `body` are rendered server-side in the recipient's
  `User.locale` at read time, never stored as text.

```
Trusted backend module (security event, profile change, …)
  └── NotificationsService.notify(input)          // owns its transaction
      or .notifyTx(tx, input)                      // joins the caller's transaction
          validate definition + payload + idempotency key
          resolve preferences + channels + recipient locale
          INSERT Notification + DELIVERED in-app delivery   [one transaction]
          + one PENDING delivery per external target (drained by the worker)

HTTP (bearer, recipient-scoped): feed, mark/archive, preferences, capabilities, SSE stream
```

Endpoint semantics not obvious from OpenAPI: mark/archive are idempotent and
recipient-scoped (a foreign id is a silent no-op, no information leak); the feed
uses **cursor** pagination (the documented exception to the project's offset
envelope — the feed is append-heavy, so offsets would skip/duplicate rows);
`GET /notifications/capabilities` advertises only currently active channels.

## Add a notification definition

A definition is a code-owned record — identifier, payload schema, default and
mandatory channels, content classification, and localized renderers. Live
definitions are in
[`core/notifications/definitions/`](../../apps/api/src/core/notifications/definitions/).

```ts
// core/notifications/definitions/your-event.definition.ts
import { z } from 'zod'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

// Allowlisted, bounded payload — durable rows and renderers see this shape, so
// keep it small, language-neutral, and free of secrets.
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
[`definitions/index.ts`](../../apps/api/src/core/notifications/definitions/index.ts).
The registry rejects duplicate `type`s at bootstrap, so a misconfiguration fails
fast on startup, not at send time.

**Payload migration rule.** Changing the durable payload shape requires **bumping
`schemaVersion` and keeping a renderer for older versions** within the retention
window — historical feed rows must still render. An unknown `type`, an
unsupported `schemaVersion`, an invalid stored payload, or a throwing renderer
falls back to a **neutral feed item for that row**, never failing the feed page.

## Produce a notification

Inject `NotificationsService` and pick the variant that matches the caller's
transaction story:

```ts
// Free-standing: informational, the business write already committed.
await this.notifications.notify({
  recipientUserId: user.id,
  type: 'your_area.your_event',
  payload: { updatedFields: ['name'] },
  idempotencyKey: `your_area.your_event:${eventId}`,
})

// Atomic with a business mutation: rolls back if the outer transaction does.
await this.prisma.$transaction(async (tx) => {
  await tx.thing.update({/* ... */})
  await this.notifications.notifyTx(tx, {
    recipientUserId: user.id,
    type: 'your_area.your_event',
    payload: { updatedFields: ['name'] },
    idempotencyKey: `your_area.your_event:${eventId}`,
  })
})
```

Use `notifyTx` when the notification is semantically part of the mutation
(security state changes, payments, org transitions); use `notify` for derived
events that are not part of the business invariant.

**Idempotency.** `idempotencyKey` is **required** and follows the grammar
`dotted.namespace:occurrence-id` (e.g. `account.password_changed:<sessionId>`,
never a bare `password-changed`). The producer fingerprints the immutable dedupe
intent (`type` + `schemaVersion` + `category` + `payload` + `action` +
`organizationId` + `occurredAt`) and stores it beside the key:

- **Same key + matching fingerprint** → existing row returned (`created: false`),
  no duplicate written.
- **Same key + different fingerprint** → `NotificationIdempotencyConflictError`
  (a caller bug, not a safe replay).

The check is atomic (`INSERT … ON CONFLICT DO NOTHING RETURNING`), so a conflict
never aborts the caller's transaction under `notifyTx`. This is the producer's
own dedupe — separate from the HTTP
[idempotency primitive](../operations/idempotency.md).

## How delivery works

**In-app** is written `DELIVERED` synchronously inside the producer transaction.

**External** deliveries (email, Telegram) are durable and worker-driven. The
producer writes one `PENDING` `NotificationDelivery` per resolved external target
in its transaction, then best-effort enqueues a BullMQ **wake job** carrying
**only the `notificationId`** — never the payload or any secret. `notifyTx`
writes the rows but enqueues nothing (the caller owns commit timing). Contract:

- **Postgres owns retry, leases, and attempts** — not BullMQ. The worker claims
  due rows with `FOR UPDATE SKIP LOCKED`, leases the row (`PROCESSING` with a TTL),
  records an immutable attempt, and finalizes with a compare-and-set on the lease
  token so a stale holder can never overwrite newer state.
- **A recovery `@Cron`** drains due deliveries on every replica, so a **lost wake**
  (Redis blip) or a `notifyTx` delivery is still delivered — at-least-once with
  provider-side idempotency.
- **Transient** failures retry with exponential backoff (capped, jittered) up to a
  budget, then dead-letter as `FAILED`; **permanent** failures fail immediately. A
  crashed worker's expired lease is reclaimed and the attempt marked abandoned.

Channels:

| Channel    | Status                  | Notes                                                       |
| ---------- | ----------------------- | ----------------------------------------------------------- |
| `in_app`   | shipped, in-transaction | Always available; feed never depends on the worker.         |
| `email`    | shipped, durable        | Worker-only adapter over `EmailService.send()` (see below). |
| `telegram` | shipped, durable        | Direct Bot API client + secret-header webhook (see below).  |
| `web_push` | deferred                | Ships with the frontend phase (service worker + VAPID).     |

**Email channel.** A worker-only adapter that calls
[`EmailService.send()`](../../apps/api/src/infrastructure/email/) directly with a
stable provider idempotency key `notification-delivery:<deliveryId>` — it **never
uses the email queue** (secret-bearing mail keeps its own direct path). Delivery
is to a **verified destination only**: an unverified account email is recorded
`SKIPPED` (`destination_unverified`), never `PENDING`, and the mandatory in-app
delivery still guarantees the user sees the event. Mail targets the produce-time
canonical verified-address snapshot, not the display address.

**Telegram channel.** Opt-in via config (see
[webhooks](../operations/webhooks.md) and `.env.example`), additive over the same
dispatcher contract. Linking (`POST /notifications/telegram/link`) returns a
one-time `t.me/<bot>?start=<token>` deep link; only the token's SHA-256 is stored.
The inbound `POST /webhooks/telegram` is `AuthType.None` and verified by a
constant-time `X-Telegram-Bot-Api-Secret-Token` header (excluded from the client
OpenAPI document); a durable `update_id` receipt makes the bind **effect-once**
under Telegram's retries, and a chat already owned by another account is never
silently moved. Delivery is plain text (no `parse_mode`). Outcomes are distinct
and observable: unlinked → `SKIPPED telegram_not_linked`; a permanent destination
error (`403` / chat-not-found) → terminal `FAILED` and the connection is fenced
`BLOCKED` (user must relink); a `429 retry_after` is honored as a retry floor. No
chat/user id, provider text, or token ever appears in an attempt or log.

## Preferences & mandatory channels

Resolving which channels deliver a notification is **top wins**:

1. The definition's `mandatoryChannels` — always on, never disabled by a user
   preference, and locked in the preferences read response.
2. The master toggle (`UserSettings.notificationsEnabled`) — gates **all
   optional** channels; mandatory channels are unaffected.
3. The stored user override for `(category, channel)`.
4. The definition's default.

In the read response, `enabled: null` means no override is stored (definition
default applies) and `mandatory: true` means a definition in the category forces
the channel, so a `PUT` attempting to disable it is rejected `400`. The starter
ships `account.profile_updated`, `account.telegram_linked`, and
`account.password_changed` (in-app **and** email mandatory), which exercises the
resolver end-to-end.

## Content & security rules

- **Language-neutral, bounded payloads.** The durable `payload` is the allowlisted
  schema shape — small, predictable, no free text. Rendering happens server-side.
- **No secrets in the subsystem.** Each definition declares a `contentClass`
  (`PUBLIC | PERSONAL | SENSITIVE`); `SECRET` content is **rejected at
  registration**. Password-reset/verification tokens and credentials must never
  appear in a `Notification.payload`, a queue job, or an attempt log — they stay
  in the direct-email paths.
- **External content uses a projection, not the raw payload.** When the content
  policy resolves an external channel to `detailed`, the adapter renders **only**
  the definition's `projectExternal(channel, payload)` allowlist (via `renderEmail`
  / the Telegram renderer). `PERSONAL` / `SENSITIVE` default to a neutral generic
  summary; a definition may opt a channel into `detailed` (as
  `account.password_changed` does for email, projecting only the non-secret change
  time).
- **Attempts store no sensitive data** — never a token, provider response body, or
  sensitive payload; only a coded outcome.
- **Retention never deletes active deliveries.** A daily worker-only sweep ages out
  old rows (defaults: archived 30d, read 90d, unread 180d, finished attempts and
  expired Telegram artifacts 30d) but never removes a notification with a
  `PENDING` / `PROCESSING` / `RETRY_SCHEDULED` external delivery. The feed is
  **not** an audit log — durable security events live in `AuditLog`.

## Realtime stream (SSE)

`GET /notifications/stream` is a bearer-authenticated
[Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
stream that pushes a **content-free hint** (`{ eventId, reason, notificationId? }`)
whenever the recipient's feed changes. It is **not** a delivery channel — every
event means _"refetch the feed and unread count"_; Postgres stays the source of
truth. Contract:

- **Cross-replica via Redis Pub/Sub**, on an environment- and version-namespaced
  channel. **No sticky sessions**; **at-most-once** — a hint dropped in a Redis blip
  is recovered by the next reconnect refetch, never replayed (no `Last-Event-ID`).
- **Bearer only** — the token goes in the `Authorization` header, never the URL, so
  clients use a fetch-stream reader, not `EventSource`. On (re)connect, establish
  the stream **then** refetch to close the subscribe-vs-snapshot race; reconnect
  with jittered backoff when the token expires.
- **Backpressure & limits** — a slow consumer that overflows its buffer is
  disconnected to resync; the per-user cap returns `429` and the global per-process
  cap `503`. Operators tune it via `NOTIFICATIONS_REALTIME_*` env vars and **must
  set a distinct `NOTIFICATIONS_REALTIME_NAMESPACE` per environment** when sharing
  one Redis. Proxy/buffering/HTTP-2 guidance is in
  [deployment](../operations/deployment.md).

A Redis outage degrades realtime to "updates appear on your next refetch"; the
feed is always correct without it.

## Add a channel

The durable model already reserves the dispatcher's lease / retry / attempt
columns, so a new worker-driven channel is **additive** — no state-machine or
claim-mechanism migration. Register a target resolver and a deliverer in
[`core/notifications/channels/`](../../apps/api/src/core/notifications/channels/)
(email and Telegram are the reference implementations), add the channel to the
relevant definitions' `supportedChannels`, and — for a `detailed` external
channel — a `projectExternal` projection so raw payloads never cross the boundary.

## What's not in the starter yet

Intentional deferrals, additive over the contract above: **Web Push** (ships with
the frontend phase), **organization recipients / fan-out / org-level preferences**,
and **digests, quiet hours, timezone scheduling, and frequency caps**.

## See also

- [Email](../email/README.md) — `EmailService` and the notification email template.
- [Webhooks](../operations/webhooks.md) — the secret-header verifier behind Telegram.
- [Idempotency](../operations/idempotency.md) — the separate HTTP primitive.
- [Deployment](../operations/deployment.md) — SSE proxy/buffering guidance.
- Source & tests — [`core/notifications/`](../../apps/api/src/core/notifications/)
  (unit specs alongside the module; e2e in
  [`apps/api/test/`](../../apps/api/test/) against real Postgres + Redis).
