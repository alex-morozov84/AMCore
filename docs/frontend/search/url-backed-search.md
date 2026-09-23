# URL-backed search

[Search overview](./README.md) · [Shared API](./shared-primitives.md) ·
[Navigation and verification](./navigation-and-verification.md)

## Contents

- [Server contract](#server-contract)
- [Feature adapter](#feature-adapter)
- [Results and navigation](#results-and-navigation)

## Server contract

The route's Server Component parses and validates its search parameters,
fetches the results, then supplies the **canonical** search, effective sort,
and page to a small Client Component adapter. Do not use raw unvalidated query
values as the authoritative props. The example below assumes that `sortBy`
and `sortOrder` already include the effective defaults chosen by the feature.
`baseHref` is the locale-prefixed path, such as `/en/catalog`.

## Feature adapter

This typed adapter covers a search box and one sort link. Replace its
catalog query policy and localized `copy` with the feature's own. It uses
real shared props; no Console import is needed.

```tsx
'use client'

import { type FormEvent, useCallback } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'
import { Button } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { SearchField } from '@/shared/ui/search-field'

type SortBy = 'name' | 'createdAt'
type SortOrder = 'asc' | 'desc'
type View = { search: string; sortBy: SortBy; sortOrder: SortOrder; page: number }
type Copy = { search: string; placeholder: string; clear: string; submit: string; sortName: string }
type Props = { baseHref: string; view: View; copy: Copy }
type Draft = ReturnType<typeof useCatalogDraft>

const normalizeSearch = (value: string) => value.trim()

function catalogHref(baseHref: string, view: View) {
  const params = new URLSearchParams()
  if (view.search) params.set('search', view.search)
  params.set('sortBy', view.sortBy)
  params.set('sortOrder', view.sortOrder)
  if (view.page > 1) params.set('page', String(view.page))
  return `${baseHref}?${params.toString()}`
}

function useCatalogDraft(baseHref: string, view: View) {
  const router = useRouteProgressRouter()
  const { search, sortBy, sortOrder, page } = view
  const expectedIdentity = useCallback(
    (nextSearch: string) =>
      catalogHref(baseHref, { search: nextSearch, sortBy, sortOrder, page: 1 }),
    [baseHref, sortBy, sortOrder]
  )
  const commit = useCallback(
    (nextSearch: string) => {
      const next = { search: nextSearch, sortBy, sortOrder, page: 1 }
      router.replace(catalogHref(baseHref, next), { scroll: false })
    },
    [baseHref, router, sortBy, sortOrder]
  )
  return useDebouncedDraft({
    authoritativeValue: search,
    authoritativeIdentity: catalogHref(baseHref, { search, sortBy, sortOrder, page }),
    getCommitIdentity: expectedIdentity,
    delayMs: 300,
    normalize: normalizeSearch,
    onCommit: commit,
  })
}

function CatalogSearchForm({ baseHref, view, copy, draft }: Props & { draft: Draft }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    draft.commitNow(draft.value)
  }

  function clear() {
    draft.setValue('')
    draft.commitNow('')
  }

  return (
    <form method="GET" action={baseHref} role="search" onSubmit={submit}>
      <SearchField
        id="catalog-search"
        name="search"
        value={draft.value}
        onValueChange={draft.setValue}
        onClear={clear}
        label={copy.search}
        placeholder={copy.placeholder}
        clearLabel={copy.clear}
      />
      <input type="hidden" name="sortBy" value={view.sortBy} />
      <input type="hidden" name="sortOrder" value={view.sortOrder} />
      <Button type="submit">{copy.submit}</Button>
    </form>
  )
}

export function CatalogSearch({ baseHref, view, copy }: Props) {
  const draft = useCatalogDraft(baseHref, view)
  const sortHref = catalogHref(baseHref, { ...view, sortBy: 'name', sortOrder: 'asc', page: 1 })

  return (
    <div>
      <CatalogSearchForm baseHref={baseHref} view={view} copy={copy} draft={draft} />
      <RouteProgressLink href={sortHref} onNavigate={draft.discardDraft}>
        {copy.sortName}
      </RouteProgressLink>
    </div>
  )
}
```

`catalogHref()` is this feature's canonical URL and identity builder. Search
commits retain the effective sort and reset to page 1. GET submission carries
the visible `search` plus current sort fields; omitting `page` resets it to 1
without JavaScript. The real link `href` also works without JavaScript.
`onNavigate` discards the armed draft on a current-tab sort navigation; opening
the link in a new tab does not change this tab's draft.

## Results and navigation

Keep result fetching in a Server Component and the interactive adapter in a
Client Component. A Server Component may also be passed as `children` through
a feature-local client boundary when pagination links need the same discard
action; this does not turn the server results module into client code. The
[navigation guide](./navigation-and-verification.md) shows that boundary and
the race/Back/Forward rules. Give pagination and recovery links real `href`s
and the same `onNavigate` discard behavior as the sort link above.
