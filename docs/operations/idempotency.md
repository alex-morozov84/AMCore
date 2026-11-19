# HTTP idempotency

AMCore provides an opt-in Redis response cache for POST endpoints. It can replay
an earlier response. It does not provide durable business idempotency or bind a
result to its owner automatically.

## Decide whether the cache fits

Before adding `@Idempotent`, establish all of these conditions:

1. The response is safe for every caller that can address the same cache entry.
   The storage identity is only `scope + Idempotency-Key`.
2. Replaying the response may skip the handler and its domain authorization checks.
   Route guards still run. Record and field decisions inside the handler do not.
3. Route parameters, query values, actor, organization, host and other headers do
   not distinguish requests automatically. Do not share a scope/key across
   different resources or tenants and assume the cache separates them.
4. A repeated handler execution after Redis failure, lock expiry or data loss is
   acceptable, or the domain independently prevents duplicate effects.

The decorator accepts a static scope, not a per-request actor/tenant binding.
A client choosing a unique-looking key is not an authorization boundary. Do not
use this primitive alone for orders, payments or other irreversible operations.
Use domain-owned durable operation identity and results when these conditions
cannot be satisfied. See the separate organization example below.

## Request and response contract

`@Idempotent({ scope: 'example_preview' })` installs the interceptor. It applies
only to POST; decorating another method does not add protection.
A POST must supply one `Idempotency-Key` header with 1–255 characters from
`A-Z`, `a-z`, `0-9`, `:`, `_`, `-`. Invalid keys return
`400 IDEMPOTENCY_KEY_INVALID`.

The request fingerprint is:

```text
sha256(method + normalized route template + raw request body bytes)
```

The route template omits actual parameter and query values. JSON whitespace or
property order can change the raw bytes and therefore the fingerprint. Preserve
both the key and exact input when retrying the same operation.

For the same scope and key, while its Redis record remains valid:

| Record | Result |
| --- | --- |
| None | Reserve the key and run the handler. |
| Completed, matching fingerprint | Replay the stored response, subject to the empty-body limitation below. |
| Completed, different fingerprint | `422 IDEMPOTENCY_KEY_REUSE`. |
| In-flight reservation, with any fingerprint | `409 IDEMPOTENCY_CONFLICT`. |

A replay returns the stored status, body and `content-type`, with
`Idempotency-Replayed: true`. It does not restore `set-cookie`, authorization,
security or per-request correlation headers. The replay marker is generated
for the replay; it is not another persisted response header.

**Current limitation:** a completed stored record whose body is the empty string
is mapped to conflict rather than replay. Do not depend on empty-body replay.
This limitation concerns the stored representation; it does not establish the
result of every HTTP adapter's empty or 204 response.

## Failure and recovery

The cache captures the serialized response, including a `5xx`, only if completion
succeeds while the original reservation is still owned. A cached `5xx` can replay
until retention expires. A returned response does not prove that it was cached.

If a response is lost or reports failure, determine the business outcome before
starting a different operation. A `5xx`, an expired record, or a missing Redis key
does not prove that nothing changed. A new key can execute the mutation again.
Do not clear the record or choose a new key merely to get past a conflict.

Defaults:

```dotenv
IDEMPOTENCY_RETENTION_SECONDS=86400
IDEMPOTENCY_LOCK_TTL_SECONDS=30
IDEMPOTENCY_FAIL_MODE="open"
IDEMPOTENCY_REDIS_TIMEOUT_MS=100
```

The in-flight reservation is not renewed. After its TTL another request can run
while the first handler still executes. Completed records expire after retention;
Redis eviction or data loss can also allow execution again. These keys are
coordination and response storage, not an atomic transaction with your database.

Redis reservation failure runs the handler without caching in the default `open`
mode. In `closed` mode it returns `503 IDEMPOTENCY_UNAVAILABLE` before the handler.
A failure to store completion still returns the original response, including in
`closed` mode. Closed mode therefore does not guarantee a saved result.
The timeout bounds waiting; it does not cancel a Redis command already issued.

## Illustrative use

This example assumes a side-effect-free preview with a non-sensitive response.
It is not a shipped endpoint. Supply your own DTO, service, guards and shared
response contract under the [backend recipe](../backend/architecture-and-conventions.md).

```ts
@Post('preview')
@Idempotent({ scope: 'example_preview' })
preview(@Body() body: PreviewDto) {
  return this.previewService.renderPublicPreview(body)
}
```

After implementing that endpoint, a caller can repeat the exact POST body with
the same valid key. A completed, non-empty stored response replays; a changed
body with that key is rejected. This is not proof of safe business mutation.

## Organization creation uses a separate domain result

Organization creation does not use this Redis response cache. An optional
`X-Organization-Creation-Id` UUIDv4 identifies a successful SQL result for one actor.
Same-input replay checks original membership/grant identities and returns current
organization metadata. Changed or deleted access is never restored. Minimal result
records have no expiry and survive account/organization deletion. A lost response
requires the same operation and input; creating a new key is not safe recovery.
Trusted initial setup uses its own constant singleton completion fact.
See [organization establishment](../product-admin/organization-establishment.md).
