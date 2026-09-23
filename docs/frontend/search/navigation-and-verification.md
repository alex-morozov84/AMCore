# Search navigation and verification

[Search overview](./README.md) · [Shared API](./shared-primitives.md) ·
[URL-backed recipe](./url-backed-search.md)

## Contents

- [Coordinate discrete links](#coordinate-discrete-links)
- [Reconcile navigation](#reconcile-navigation)
- [Verify the feature](#verify-the-feature)

## Coordinate discrete links

The [URL-backed example](./url-backed-search.md#feature-adapter) puts one sort
link beside its search form. If sort, pagination, or recovery links live in
server-rendered results, move that example's `useDebouncedDraft` call into a
**feature-local client boundary**. Render the form and the server results
under that boundary. This is a composition sketch, with feature-owned
components named for illustration:

```tsx
<CatalogSearchBoundary canonicalView={view}>
  <CatalogSearchForm />
  <Suspense fallback={<CatalogResultsSkeleton />}>
    <CatalogResults />
  </Suspense>
</CatalogSearchBoundary>
```

`CatalogResults` stays a Server Component when passed through a client
component as `children`; do not mark the page or layout `'use client'`.
The boundary provides its `draft.discardDraft` through a feature-local
context. A small client link adapter reads it and composes the existing
route-progress link:

```tsx
'use client'

import { createContext, type ComponentProps, type ReactNode, useContext } from 'react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const DiscardContext = createContext<(() => void) | null>(null)

export function CatalogDraftScope({
  discardDraft,
  children,
}: {
  discardDraft: () => void
  children: ReactNode
}) {
  return <DiscardContext value={discardDraft}>{children}</DiscardContext>
}

type Props = Omit<ComponentProps<typeof RouteProgressLink>, 'onNavigate'>

export function CatalogNavigationLink(props: Props) {
  const discardDraft = useContext(DiscardContext)
  if (!discardDraft) throw new Error('CatalogNavigationLink requires CatalogDraftScope')
  return <RouteProgressLink {...props} onNavigate={discardDraft} />
}
```

The boundary wraps its form and server `children` in
`<CatalogDraftScope discardDraft={draft.discardDraft}>`; the link reads that
**feature-local context**, with no global navigation protocol. Use this link
for every sort, pagination, and out-of-range recovery action. `onNavigate`
runs for a current-tab client navigation attempt; modifier/new-tab activation
leaves this tab's draft intact. A link to the already displayed URL can still
call `onNavigate`, so render an active page/sort item without a link when it
should preserve the draft. Give
the link a complete `href` derived from the already committed view, so both
JavaScript and no-JavaScript navigation preserve the intended search/sort/page.
Never cancel the draft merely on `onClick`, which also fires for modifier clicks.

## Reconcile navigation

Build the authoritative and expected identities from the same canonical
feature view: route/base path, normalized search, effective sort, and page.
Search commits normally keep sort and target page 1. A different incoming
identity resets the draft and its timer. A matching latest self identity is
consumed without erasing text the user typed since the commit. A discrete
link calls `discardDraft()` before navigating so a pending debounce cannot
later send the browser back to the search target.

`useDebouncedDraft` stores only the **latest** expected self identity. It is
appropriate when a newer navigation prevents an older unapplied response from
becoming the view. The installed Next.js 16.3.5 App Router discards a pending
navigation when a newer navigate or Back/Forward restore starts. If a
different transport may apply old responses, its feature adapter must first
enforce this ordering; the shared hook does not cancel network requests.

There is one deliberate Back/Forward limit. Suppose search commit A is still
expected, the user types newer draft B, and Back lands on the **exact full
canonical view A** before A's echo is consumed. From the hook's props that
looks identical to its own A echo, so B stays visible and may later commit.
Back to a _different_ canonical view resets the field. This limitation is
why the identity must include sort and page, not just search text.

## Verify the feature

| Risk                   | Check                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Field contract         | Label, localized copy, one clear action, refocus, max length if the feature has one                     |
| Draft timing           | Final rapid value commits after the delay; submit/clear cancels the old timer and commits once          |
| Canonical view         | Search trims as intended, retains effective sort, resets page; external sort/page/Back resyncs          |
| Discrete links         | Type, then sort/page/recover before debounce: the link wins; modifier/new-tab does not discard this tab |
| No JavaScript          | GET form sends `search` and current sort; page resets by omission; href links still work                |
| Race ordering          | Repeated commits, matching latest echo, different authority, and stale echo after discard               |
| Server/client boundary | Server results remain server-rendered while the client boundary retains the draft                       |

Start with focused unit/component tests and `pnpm --filter web test:run`, then
`pnpm --filter web lint`, `pnpm --filter web typecheck`, and
`pnpm --filter web build`. Drive the route in a browser for the timing and
keyboard cases; use `pnpm --filter web test:e2e` for mocked browser behavior.
Use `pnpm --filter web test:e2e:real-stack` when the change depends on the
actual auth/BFF/cookie/Redis/App Router stack. The full verification loop and
lane selection live in [Frontend testing](../testing.md).
