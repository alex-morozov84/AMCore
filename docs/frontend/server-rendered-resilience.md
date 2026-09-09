# Server-Rendered Graceful Degradation

How a page composed of several independently-fetched Server Component
sections survives one section's transient backend failure without a
generic crash, a false empty state, or a silent, unlogged degradation. See
ADR-079 for the full design record, including two approaches this starter
tried and rejected — real evidence from probing the installed Next version,
kept there rather than repeated here.

## Primary vs. secondary

A page's sections split into two kinds:

- **Primary** — the route has no reason to exist without it. A failed
  primary read shows an explicit, localized "temporarily unavailable" state
  with a retry control. Never an empty state pretending there is simply
  nothing to show.
- **Secondary** — valuable, but the page still does its job without it. A
  failed secondary read degrades that section silently for the user
  (hidden, disabled, or a small inline note — your choice) while still
  being logged for the team.

Whether a given fetch is primary or secondary is a product decision made at
the call site, not something these primitives infer.

## The data layer: `DataOutcome<T>`

`shared/api/server/fetchBackend(path, schema, { auth, timeoutMs?, signal? })`
calls `apps/api` directly (see
[API consumption § Server Components: direct backend transport](./api-consumption.md#server-components-direct-backend-transport-adr-079)
for the transport contract) and returns a closed, Zod-validated
`DataOutcome<T>`:

```ts
type DataOutcome<T> =
  | { status: 'success'; data: T }
  | { status: 'not-found' } // only for an authoritative primary lookup
  | {
      status: 'unavailable'
      reason: 'rate-limited' | 'timeout' | 'network' | 'upstream'
      retryAfterMs?: number
      correlationId?: string
    }
```

`'unavailable'` is the only outcome a secondary section may degrade
silently for. A malformed `2xx` payload, an unexpected 4xx, or any
exception `fetchBackend` doesn't recognize is **not** part of this closed
set — it throws instead, on purpose, so a real bug or a schema mismatch
never quietly reads as "the widget is just gone."

## Rendering the outcome — a plain branch, never a throw

`degradeSecondary()` and `resolvePrimary()` (`shared/api/server/`) both
turn a `DataOutcome` into an ordinary render decision. Neither throws for a
known `'unavailable'` outcome, and each logs it exactly once, at the point
of resolution:

```ts
type SecondaryRenderOutcome<T> =
  { status: 'available'; data: T } | { status: 'degraded'; reason: UnavailableReason }

type PrimaryRenderOutcome<T> =
  | { status: 'available'; data: T }
  | { status: 'unavailable'; reason: UnavailableReason; retryAfterMs?: number }
```

A secondary section:

```tsx
const facets = degradeSecondary(await fetchFacets(), { source: 'facets' })
if (facets.status === 'degraded') return null // or a disabled/inline-note UI — your choice
return <FacetList facets={facets.data} />
```

A primary section:

```tsx
const outcome = resolvePrimary(await fetchProductDetail(id), { source: 'product-detail' })
if (outcome.status === 'unavailable') {
  return <PrimaryUnavailableFallback reason={outcome.reason} retryAfterMs={outcome.retryAfterMs} />
}
return <ProductDetail data={outcome.data} />
```

`PrimaryUnavailableFallback` (`shared/ui/`) renders a closed, translated
message — never the raw `reason`, `retryAfterMs`, or anything read off an
error, because nothing was ever thrown. Its retry control calls
`router.refresh()` from `@/i18n/navigation` (locale-aware; re-runs the
Server Component tree for the current route without a full page reload).

## Why nothing is thrown for a known failure

An earlier design in this same track threw a classified error for
`catchError` (`next/error`) to catch, with a static UI-policy prop
distinguishing what to render. Empirically disproven against this
project's installed Next version: a custom `Error` subclass's fields do not
reliably survive from a Server Component to a `catchError` fallback — dev
mode already drops custom fields, and production additionally replaces the
message and regenerates the `digest`. A second attempt tried to log the
known failure once server-side at throw time and have
`instrumentation.ts`'s `onRequestError` recognize and skip the
already-logged instance — that had the same underlying problem: no
principled reason a dedup marker would survive processing any more
reliably than the classification fields already proven not to.

The fix wasn't a better marker. It was removing the throw: a known
`'unavailable'` outcome is data, not an exception, so it never needs to
cross an error boundary at all. Full empirical record: ADR-079.

## `SectionErrorBoundary` — for genuinely unexpected exceptions only

`shared/ui/section-error-boundary.tsx` wraps `catchError` and is the safety
net for a real bug escaping a primary or secondary section — not a
classified `DataOutcome`, which never reaches it by construction:

```tsx
<SectionErrorBoundary>
  <QueuePanel />
</SectionErrorBoundary>
```

Its fallback is generic ("Something went wrong" + retry) and never
branches on the caught error's content, for the same empirically-grounded
reason above. Its `retry()` re-fetches and re-renders the boundary's
children inside a Transition — the right recovery for an actually-thrown
exception, which `PrimaryUnavailableFallback`'s `router.refresh()` is not
a substitute for and vice versa: two different failure classes, two
different recovery mechanisms.

The existing route-level `error.tsx` convention (see
`app/[locale]/(dashboard)/error.tsx` for AMCore's own example) is not
replaced by any of this — it stays the outermost last-resort net.
`SectionErrorBoundary` is the granular, in-page one that keeps one
section's bug from ever reaching it.

## 404 is a separate, route-scoped concern

Only an authoritative lookup of the resource a route actually names may
call `notFound()` — a secondary endpoint's 404 never makes the route 404,
and a listing endpoint's 404 is normally a contract bug, not "no results."
Next's own HTTP contract makes the timing a hard constraint, not a
preference: the response commits to `200 OK` the instant a Suspense
fallback renders or a component suspends, so a real 404 status must be
resolved **before** any `await`/Suspense boundary in that route. Prefer one
combined fetch that returns existence and data together over a separate
existence check — it avoids both the extra round trip and a TOCTOU window.

## Logging

`shared/lib/server-logger/` gives `apps/web` a minimal, bounded Pino
foundation — see
[Web Server Logs](../operations/observability.md#web-server-logs) for the
full contract (event shape, redaction, volume suppression).
`degradeSecondary()`/`resolvePrimary()` already call it; you don't call it
yourself unless you're building a new primitive on top of `fetchBackend()`.

## Deliberately out of scope

- **Automatic retry.** Default is zero automatic attempts — recovery is
  always user-driven (the fallback's retry control). A future automatic
  retry would need to be idempotent, deadline-bound, jittered, and
  budgeted; that's a real design task for when a concrete need justifies
  it, not a default.
- **A stateful circuit breaker.** The bounded timeout on `fetchBackend()`
  covers the realistic transient case for a starter; a breaker that tracks
  failure rate across requests to stop hammering a known-down dependency is
  real infrastructure with its own tuning/observability surface — an
  escalation path for a downstream product under measured load, not
  something this starter ships speculatively.
- **`stale-if-error` (RFC 5861).** Serving last-known-good cached data
  instead of degrading needs a cache with something stale to serve — a
  separate, Redis-backed design with its own TTL/invalidation cost.
- **A demo/catalog page.** These primitives are domain-agnostic on
  purpose; there is no reference product page in this repo. The
  Operations Console (a first-party admin surface) is the first real
  consumer of the secondary path — its queue-backlog, AI-approval, and
  audit-browsing panels reuse `degradeSecondary()` rather than inventing
  their own handling.
