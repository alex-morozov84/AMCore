# Webhook Verification

AMCore provides inbound webhook verification. Stripe and generic signatures use
the raw request body. Telegram uses a static secret header instead. Verification
does not prove that a business event was committed.

For a new public webhook route, use explicit public auth and a dedicated rate
limit. This is an illustrative Stripe route, not a shipped endpoint:

```ts
@Post('webhooks/stripe')
@HttpCode(200)
@Auth(AuthType.None)
@RateLimit({ rate: 5, per: 60_000, burst: 5 })
@VerifyWebhook('stripe')
handleStripe() {
  return { received: true }
}
```

`rawBody` must be available for verification. AMCore enables it globally in the
Nest bootstrap, so webhook guards verify `req.rawBody` directly.

## Built-in Providers

AMCore currently wires three provider names into `@VerifyWebhook(provider)`:

- `stripe`
- `generic`
- `telegram`

### `stripe`

- header: `Stripe-Signature`
- format: `t=<unix-seconds>,v1=<hex-hmac>[,v1=...]`
- signed payload: `<timestamp>.<raw body bytes>`

### `generic`

- headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`
- signed payload: `<id>.<timestamp>.<raw body bytes>`
- signature format: `sha256=<hex-hmac>`

The generic HMAC verifier implementation also supports a GitHub-style raw-body
`sha256=` signature mode for custom integrations, but the built-in `generic`
provider is currently wired to the standard `webhook-id` /
`webhook-timestamp` / `webhook-signature` header set.

### `telegram`

A different verifier **family**: Telegram provides **no body signature and no
timestamp**. `setWebhook(secret_token=…)` makes Telegram attach a static shared secret in
the `X-Telegram-Bot-Api-Secret-Token` header on every POST; the verifier compares it to
`WEBHOOK_TELEGRAM_SECRET` in constant time. A missing / array / non-string header is a
uniform `401`.

- header: `X-Telegram-Bot-Api-Secret-Token`
- format: the raw secret (`1–256` of `A-Za-z0-9_-`), no signature, no timestamp

**Replay/dedupe is owned by the handler, not the primitive**, for Telegram: its
`update_id` can outlive any Redis TTL, so the provider's `replayId` returns `undefined`
(the Redis dedupe layer is a deliberate no-op) and the `/webhooks/telegram` handler dedupes
on `update_id` in Postgres under its own transaction and retention policy. This
does not promise that every business side effect is globally effect-once. The webhook route is excluded from the
client OpenAPI surface.

All signature/secret comparisons use a constant-time comparison helper.

## Environment

Webhook verification is opt-in per provider secret:

```dotenv
WEBHOOK_STRIPE_SECRET=""
WEBHOOK_GENERIC_SECRET=""
WEBHOOK_TELEGRAM_SECRET=""   # 1–256 of A-Za-z0-9_- (Telegram secret_token grammar)
WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300
WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS=300
```

Notes:

- Only the three registered names above are wired. Adding an environment variable
  does not install a new provider adapter.
- `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` defaults to `300`.
- `WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS` defaults to the timestamp tolerance when
  omitted.

## Replay Protection

The built-in Stripe and generic verifiers enforce timestamp tolerance. The
custom raw-body HMAC mode has no timestamp check; Telegram also has none.
Adding a raw-body mode requires a reviewed adapter and an explicit replay policy.

For Stripe and generic events with a stable event ID, the guard also uses:

```text
webhook:v1:{provider}:{eventId}
```

Signature verification does not depend on Redis. Event-ID dedupe fails open if
Redis is unavailable or times out. A provider without an ID gets no Redis dedupe;
only that verifier family's actual signature/timestamp checks still apply.

**The guard marks an ID before the handler runs.** If the handler then fails,
a retry can be rejected until the Redis TTL expires. Conversely, Redis failure,
expiry or data loss can admit the event again. A dedupe record proves neither
successful processing nor an atomic commit with business data.

For durable effects, the handler must own the event identity, authorized target,
transaction/result and retention policy. Choose provider acknowledgement and retry
behavior around that durable result. The built-in pre-handler Redis marker can
block recovery before your handler is reached. If provider retries are required
for correctness, the route needs an explicitly reviewed admission/recovery design;
a durable handler alone does not remove this earlier gate. Do not invent a new event ID or clear the
Redis marker to retry an unknown business outcome. If processing is deferred,
use the [background-work contract](../backend/background-work.md); enqueueing alone
is not proof of the completed effect.

Current replay-ID extraction:

- `stripe`: request body field `id`
- `generic`: `webhook-id` header
- `telegram`: none — `replayId` is `undefined`; the handler owns durable `update_id`
  dedupe in Postgres (a TTL-bounded Redis hint is not authoritative for a linking side
  effect).

## Throttling

Webhook routes should use a dedicated `@RateLimit(...)` override (see
`docs/backend/architecture-and-conventions.md` → Rate limiting), sized to the
source's documented rate. Never `@SkipRateLimit()` for a webhook — an
unthrottled public ingress is an open volumetric target.

## Request body size limit

Webhook JSON and urlencoded bodies use the default **100 000 decoded bytes**
limit. Exactly 100 000 bytes is admitted by size; 100 001 is rejected. Other
validation and signature checks can still reject an admitted body.

An oversized body returns `413 PAYLOAD_TOO_LARGE` before guards run. Verification
uses the decoded, post-inflation `req.rawBody` buffer, not re-serialized JSON.
Multipart has separate route limits and `FILE_TOO_LARGE` behavior.

See [the request-body contract](../backend/request-body-contract.md) for current
route exceptions, encoding, parser order and limits. Exceptions on other routes
do not enlarge the webhook limit.

## Error Contract

The outward HTTP contract is intentionally uniform:

- `401 Unauthorized` for invalid signature, invalid timestamp, or rejected replay
- `400 Bad Request` for missing configuration or unsupported payload format
- `413 Payload Too Large` (`PAYLOAD_TOO_LARGE`) when the request body exceeds the
  global size limit — raised before signature verification

Human-readable messages stay uniform for the `401` cases, but the response keeps
distinct machine-readable `errorCode` values:

- `WEBHOOK_SIGNATURE_INVALID`
- `WEBHOOK_TIMESTAMP_INVALID`
- `WEBHOOK_REPLAY_REJECTED`
- `WEBHOOK_CONFIGURATION_MISSING`
- `WEBHOOK_PAYLOAD_UNSUPPORTED`

## Redaction

AMCore redacts:

- signature headers such as `stripe-signature`, `webhook-signature`, and
  `x-hub-signature-256`, plus the Telegram secret header;
- the entire request body for routes under the `/webhooks/` path convention.

If you want automatic webhook body redaction in logs, mount the route under a
`/webhooks/` path.

## Example

Illustrative request shape for an implemented route (not an executable signed
request): the timestamp and HMAC below are placeholders. A real request needs
a current timestamp and a signature of its exact bytes using the configured secret:

```bash
curl -X POST http://localhost:5002/api/v1/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -H 'Stripe-Signature: t=1717770000,v1=<hex-hmac>' \
  -d '{"id":"evt_123","type":"payment_intent.succeeded"}'
```

Expected outcomes:

- valid signature + acceptable timestamp + first event ID -> handler runs;
  the illustrative handler above returns `200`, while your domain handler can fail
- invalid signature -> `401` with `errorCode: "WEBHOOK_SIGNATURE_INVALID"`
- duplicate event ID -> `401` with `errorCode: "WEBHOOK_REPLAY_REJECTED"`
