# HTTP Idempotency

AMCore ships an opt-in HTTP idempotency primitive for unsafe POST endpoints.
Enable it with:

```ts
@Post('orders')
@Idempotent({ scope: 'orders' })
createOrder(@Body() body: CreateOrderDto) {
  return this.ordersService.create(body)
}
```

The primitive is implemented as a Nest interceptor, so it can both short-circuit
before the handler and replay a cached response after a previous successful
reservation.

## Scope And Header

Current rules:

- only `POST` is supported;
- clients must send `Idempotency-Key`;
- the Redis key is `idem:v1:{scope}:{key}`.

`Idempotency-Key` validation:

- single header value only;
- allowed characters: `A-Z`, `a-z`, `0-9`, `:`, `_`, `-`;
- length: `1..255`.

Invalid keys return `400 IDEMPOTENCY_KEY_INVALID`.

## Request Fingerprint

AMCore fingerprints the request as:

```text
sha256(method + route template + raw body)
```

Important details:

- it uses the normalized route template, not the raw URL;
- it uses the raw request body bytes, not parsed JSON.

This prevents false mismatches from harmless URL differences and avoids
serializer drift.

## Runtime Semantics

For the same `scope + Idempotency-Key`:

- first request reserves the key and executes the handler;
- same key + same fingerprint + completed record -> replay the cached response;
- same key + different fingerprint -> `422 IDEMPOTENCY_KEY_REUSE`;
- same key while the first request is still in flight -> `409 IDEMPOTENCY_CONFLICT`.

Replay responses include:

```text
Idempotency-Replayed: true
```

If the client wants a genuinely new attempt, it must send a new
`Idempotency-Key`.

## First Executed Result Wins, Including 5xx

AMCore caches the first executed response, including `5xx`, to avoid repeating
side effects after the handler has already crossed a mutation boundary.

Consequence:

- a `5xx` returned by the first executed attempt remains cached until the
  retention TTL expires;
- retrying with the same key replays that `5xx`;
- clients must use a new key for a genuinely new attempt.

This matches Stripe-style idempotency semantics.

## Replay Headers

Replay persists and restores only a narrow header allowlist:

- `content-type`
- `Idempotency-Replayed`

AMCore does not replay:

- `set-cookie`
- auth/security headers
- per-request correlation or request-ID headers

## Redis State And Timing

Redis keys use the versioned keyspace:

```text
idem:v1:{scope}:{key}
```

Stored states:

- `in_flight` with `ownerToken`, fingerprint, and start timestamp
- `completed` with fingerprint, status, allowlisted headers, body, and completion timestamp

Defaults:

```dotenv
IDEMPOTENCY_RETENTION_SECONDS=86400
IDEMPOTENCY_LOCK_TTL_SECONDS=30
IDEMPOTENCY_FAIL_MODE="open"
IDEMPOTENCY_REDIS_TIMEOUT_MS=100
```

Behavior:

- retention TTL defaults to `86400` seconds;
- in-flight lock TTL defaults to `30` seconds;
- Redis calls are bounded by a short timeout;
- default mode is fail-open;
- `IDEMPOTENCY_FAIL_MODE=closed` changes Redis unavailability into
  `503 IDEMPOTENCY_UNAVAILABLE`.

## Example

First request:

```bash
curl -X POST http://localhost:5002/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123' \
  -d '{"amount":1000}'
```

Possible follow-up outcomes with the same key:

- same body after completion -> `201` (or the original status) with
  `Idempotency-Replayed: true`
- different body -> `422 IDEMPOTENCY_KEY_REUSE`
- concurrent retry while the first request is still running ->
  `409 IDEMPOTENCY_CONFLICT`

Example replay:

```bash
curl -X POST http://localhost:5002/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123' \
  -d '{"amount":1000}'
```

Response characteristics:

- same status as the first completed attempt
- same cached body as the first completed attempt
- `Idempotency-Replayed: true`
