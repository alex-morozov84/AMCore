# Webhook Verification

AMCore ships an inbound webhook verification primitive for signed requests. It
verifies the request signature against the raw request body, not a bearer token
or a re-serialized JSON payload.

Use it on public webhook routes together with explicit public auth:

```ts
@Post('webhooks/stripe')
@Auth(AuthType.None)
@Throttle({ long: { limit: 5, ttl: 60_000 } })
@VerifyWebhook('stripe')
handleStripe(@Req() req: RawBodyRequest<Request>) {
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

A different verifier **family** (Arc D): Telegram provides **no body signature and no
timestamp**. `setWebhook(secret_token=…)` makes Telegram attach a static shared secret in
the `X-Telegram-Bot-Api-Secret-Token` header on every POST; the verifier compares it to
`WEBHOOK_TELEGRAM_SECRET` in constant time. A missing / array / non-string header is a
uniform `401`.

- header: `X-Telegram-Bot-Api-Secret-Token`
- format: the raw secret (`1–256` of `A-Za-z0-9_-`), no signature, no timestamp

**Replay/dedupe is owned by the handler, not the primitive**, for Telegram: its
`update_id` can outlive any Redis TTL, so the provider's `replayId` returns `undefined`
(the Redis dedupe layer is a deliberate no-op) and the `/webhooks/telegram` handler dedupes
durably on `update_id` in Postgres (effect-once). The webhook route is excluded from the
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

- `WEBHOOK_<PROVIDER>_SECRET` maps provider names to secrets.
- `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` defaults to `300`.
- `WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS` defaults to the timestamp tolerance when
  omitted.

## Replay Protection

Replay protection has two layers:

- timestamp tolerance is always enforced;
- Redis event-ID dedupe is used when the provider exposes a stable event ID.

Redis dedupe keys use the versioned keyspace:

```text
webhook:v1:{provider}:{eventId}
```

Behavior:

- signature verification does not depend on Redis;
- if Redis is unavailable or times out, replay dedupe fails open;
- if the provider does not expose a stable event ID, only timestamp tolerance is
  applied.

Current replay-ID extraction:

- `stripe`: request body field `id`
- `generic`: `webhook-id` header
- `telegram`: none — `replayId` is `undefined`; the handler owns durable `update_id`
  dedupe in Postgres (a TTL-bounded Redis hint is not authoritative for a linking side
  effect).

## Throttling

Webhook routes should use a dedicated `@Throttle(...)` override. Do not use
`@SkipThrottle()` for webhooks.

## Request body size limit

AMCore applies one explicit request-body size limit globally in the Nest
bootstrap: **100 000 bytes** (decimal, not 100 KiB) for both JSON and
urlencoded parsers, including raw-body webhook routes. The limit is centralized
in `apps/api/src/bootstrap/configure-body-parser.ts` (`REQUEST_BODY_LIMIT_BYTES`)
and shared by production and the e2e bootstrap so the contract is identical in
both.

The limit is measured against the **decoded** body — bytes after any
`Content-Encoding` inflation, not bytes on the wire (`inflate` defaults to true).
For an uncompressed request the decoded size equals the wire size; for a
gzip/deflate request the limit bounds the inflated size, so a small compressed
body that inflates past the limit is still rejected.

Behavior:

- a decoded body of exactly `100 000` bytes is accepted; `100 001` is rejected;
- an oversized body is rejected by the parser **before** the route's guards run,
  so a webhook signature is never evaluated for a too-large payload;
- the rejection surfaces as `413 Payload Too Large` with
  `errorCode: "PAYLOAD_TOO_LARGE"` (see _Error Contract_ below);
- signature verification is unaffected: the verifier hashes `req.rawBody`, the
  decoded (post-inflation) body buffer, and the explicit limit does not change
  those bytes;
- multipart uploads are **not** governed by this value; they have their own
  per-route Multer limit and `FILE_TOO_LARGE` contract.

There is intentionally no separate, larger webhook limit: no current provider
payload requires one. Raise `REQUEST_BODY_LIMIT_BYTES` only against a measured
need.

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
  `x-hub-signature-256`;
- the entire request body for routes under the `/webhooks/` path convention.

If you want automatic webhook body redaction in logs, mount the route under a
`/webhooks/` path.

## Example

Example Stripe-style request shape:

```bash
curl -X POST http://localhost:5002/api/v1/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -H 'Stripe-Signature: t=1717770000,v1=<hex-hmac>' \
  -d '{"id":"evt_123","type":"payment_intent.succeeded"}'
```

Expected outcomes:

- valid signature + acceptable timestamp + first event ID -> `200`
- invalid signature -> `401` with `errorCode: "WEBHOOK_SIGNATURE_INVALID"`
- duplicate event ID -> `401` with `errorCode: "WEBHOOK_REPLAY_REJECTED"`
