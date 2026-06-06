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

AMCore currently wires two provider names into `@VerifyWebhook(provider)`:

- `stripe`
- `generic`

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

All signature comparisons use a constant-time comparison helper.

## Environment

Webhook verification is opt-in per provider secret:

```dotenv
WEBHOOK_STRIPE_SECRET=""
WEBHOOK_GENERIC_SECRET=""
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

## Throttling

Webhook routes should use a dedicated `@Throttle(...)` override. Do not use
`@SkipThrottle()` for webhooks.

## Error Contract

The outward HTTP contract is intentionally uniform:

- `401 Unauthorized` for invalid signature, invalid timestamp, or rejected replay
- `400 Bad Request` for missing configuration or unsupported payload format

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
