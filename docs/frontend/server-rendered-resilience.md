# Server-Rendered Graceful Degradation

Use this pattern when a page has independently fetched Server Component
sections and one failure must not replace the whole page with a generic error,
pretend failed content is empty, or disappear without a server log. ADR-079
records the design and the rejected error-serialization approaches.

## Classify the section, then the outcome

- **Primary:** the route cannot fulfil its purpose without it. A known
  availability failure renders an explicit localized unavailable state and a
  retry control—never an empty state.
- **Secondary:** the route still works without it. A known availability failure
  may hide or disable only that section, or show a small inline note. The caller
  owns that choice; do not show a global toast.

`fetchBackend(path, schema, { auth, timeoutMs?, signal?, cache?, tokenResolver? })`
calls `apps/api` directly and returns a Zod-validated `DataOutcome<T>`. Omit
`tokenResolver` for the product session (the default); a caller with its own
isolated session passes its own resolver. For example, the Operations Console
passes `getConsoleAwareAccessToken`. If that resolver returns `null`, the
transport does not fall back to the product session:

```ts
type DataOutcome<T> =
  | { status: 'success'; data: T }
  | { status: 'not-found' }
  | {
      status: 'unavailable'
      reason: 'rate-limited' | 'timeout' | 'network' | 'upstream'
      retryAfterMs?: number
      correlationId?: string
    }
```

Only `'unavailable'` may degrade quietly. Invalid `2xx` payloads, unexpected
4xx responses, and unrecognized exceptions throw so schema drift and bugs do
not masquerade as a missing widget. See
[API consumption](./api-consumption.md#server-components-direct-backend-transport-adr-079)
for the direct-transport and authentication contract.

## Render known outcomes as data

`degradeSecondary()` and `resolvePrimary()` log a known failure once and return
an ordinary render decision. Neither throws for `'unavailable'`.

```tsx
const facets = degradeSecondary(await fetchFacets(), { source: 'facets' })
if (facets.status === 'degraded') return null // or disabled/inline-note UI
return <FacetList facets={facets.data} />
```

```tsx
import { notFound } from 'next/navigation'

// Resolve the route's authoritative read before streaming starts.
const outcome = await fetchProductDetail(id)
if (outcome.status === 'not-found') notFound()

const product = resolvePrimary(outcome, { source: 'product-detail' })
if (product.status === 'unavailable') {
  return <PrimaryUnavailableFallback reason={product.reason} retryAfterMs={product.retryAfterMs} />
}
return <ProductDetail data={product.data} />
```

`PrimaryUnavailableFallback` shows a translated rate-limit message for
`rate-limited`. Pass `retryAfterMs` to show the server’s wait in whole seconds
when it is positive. Other reasons use the general unavailable message.
The button calls
`router.refresh()` through `useRouteProgressRouter()` (a deliberate pass-through
that does not start the bar), requesting a new Server Component payload without
resetting unaffected client state.

`router.refresh()` does not invalidate the server-side cache. For a read that
must reach the backend on every request, pass `cache: 'no-store'` to
`fetchBackend()`. If a loader opts into caching, use a matching
`revalidatePath` or `revalidateTag` policy. Refresh can return the same cached
result until it is invalidated.

## Catch unexpected exceptions per section

`SectionErrorBoundary` wraps Next's `catchError` for programming errors,
malformed data, and other exceptions outside the known availability set:

```tsx
<Suspense fallback={<QueuePanelSkeleton />}>
  <SectionErrorBoundary>
    <QueuePanel />
  </SectionErrorBoundary>
</Suspense>
```

Place independently fetched async sections in sibling `Suspense` boundaries.
They stream independently, and an error after the shell starts replaces only
the failed section. The boundary's generic translated fallback never branches
on `message`, `name`, `digest`, or a custom subclass; its `retry()` re-fetches
and re-renders its children. This differs deliberately from the known primary
path's route-level `router.refresh()`.

HTTP status depends on when rendering fails. Once a Suspense fallback commits
the stream, the response remains `200` even if a section later fails. If an
exception happens before streaming starts, Next can return `500` while still
rendering the section fallback in the response body. Monitor the structured
server-error event as well as status codes; do not infer section health from
`200` alone. Also verify that production proxies/CDNs support streaming if the
deployment depends on independent section delivery.

The route-level `error.tsx` remains the outermost last-resort boundary. A
section boundary does not replace it.

## Keep 404 route-scoped and early

Only the authoritative lookup for the resource named by the route may call
`notFound()`. A secondary endpoint's 404 never makes the route 404, and a list
endpoint's 404 is normally a contract bug rather than "no results."

Resolve authoritative existence before any `await`/Suspense boundary that can
start streaming. After the response commits to `200`, Next can only produce a
soft 404. Prefer one backend call that returns existence and data together over
a second existence request; it avoids latency and a TOCTOU window.

## Logging and extension points

`degradeSecondary()` and `resolvePrimary()` already emit bounded structured
logs through `shared/lib/server-logger/`; callers do not log the same failure
again. See [Web Server Logs](../operations/observability.md#web-server-logs).

The starter deliberately does not add:

- automatic SSR retries—the default is zero; recovery is user-driven;
- a stateful circuit breaker, which needs measured thresholds and operations;
- stale-if-error data, which needs a real cache and invalidation policy;
- a fake catalog/demo route.

The Operations Console's Organizations results use `resolvePrimary()` for
the primary read. Its Overview reads several sources independently through
`readOverviewSources()`. An unavailable source can degrade without hiding
data from the other sources.

A successful `GET /admin/overview` response contains a typed readiness value:
`ready`, `degraded` or `not_ready`. Overview renders that value as observed
service state. If the read itself is unavailable, it shows the unavailable
source separately and still renders the other results. Apply the same
distinction when you add dependency health to another page.
