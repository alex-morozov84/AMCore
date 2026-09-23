# Shared search primitives

[Search overview](./README.md) · [URL-backed recipe](./url-backed-search.md)

## Contents

- [SearchField](#searchfield)
- [Local filtering](#local-filtering)
- [useDebouncedDraft](#usedebounceddraft)
- [What the shared layer does not own](#what-the-shared-layer-does-not-own)

## SearchField

Import `SearchField` from `@/shared/ui/search-field`. It is a controlled text
input with a search icon and one clear button. Clearing calls `onClear` and
returns focus to the input. It uses `type="text"`, so the browser does not add
a second native search clear control.

| Prop                                 | Purpose                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `id`, `name`                         | Input identity and form field name, chosen by the feature |
| `value`, `onValueChange(value)`      | Current text and edit callback                            |
| `onClear()`                          | Feature-owned reset or immediate search action            |
| `label`, `placeholder`, `clearLabel` | Caller-supplied, localized accessible copy                |
| `maxLength?`, `className?`           | Optional presentation constraints                         |

The field creates no form, request, debounce, URL, or results. Put its copy in
every live message catalogue (`messages/en.json` is the base); do not put
English strings inside the shared component. Its co-located tests cover the
controlled behavior and refocus; its Storybook story shows empty and populated
states.

## Local filtering

For a list already in memory, keep the value in the feature. No authoritative
server value or draft reconciliation is needed:

```tsx
'use client'

import { useState } from 'react'

import { SearchField } from '@/shared/ui/search-field'

type Item = { id: string; name: string }
type Labels = { search: string; placeholder: string; clear: string }
type Props = { items: Item[]; labels: Labels; locale: string }

function FilteredItems({
  items,
  needle,
  locale,
}: {
  items: Item[]
  needle: string
  locale: string
}) {
  return (
    <ul>
      {items
        .filter((item) => item.name.toLocaleLowerCase(locale).includes(needle))
        .map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
    </ul>
  )
}

export function ItemFilter({ items, labels, locale }: Props) {
  const [value, setValue] = useState('')
  const needle = value.trim().toLocaleLowerCase(locale)

  return (
    <>
      <SearchField
        id="item-filter"
        name="filter"
        value={value}
        onValueChange={setValue}
        onClear={() => setValue('')}
        label={labels.search}
        placeholder={labels.placeholder}
        clearLabel={labels.clear}
      />
      <FilteredItems items={items} needle={needle} locale={locale} />
    </>
  )
}
```

The example's matching rule is only a feature choice; pass the current locale
from the feature and choose its real matching/collation policy. If results come
from a server, follow the [URL-backed recipe](./url-backed-search.md) instead.

## useDebouncedDraft

Import `useDebouncedDraft` from `@/shared/lib/use-debounced-draft` for a
temporary text draft whose canonical value is supplied by a parent/server.
It has no router or Console dependency:

| Option                                | Meaning                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `authoritativeValue: string`          | Canonical search text from the current result view                              |
| `authoritativeIdentity?: string`      | Opaque identity of the **whole** current view; defaults to `authoritativeValue` |
| `getCommitIdentity?(normalizedValue)` | Whole-view identity expected after this commit; defaults to that value          |
| `delayMs: number`                     | Delay before committing an edit                                                 |
| `normalize?(value)`                   | Conversion before commit, such as trim; defaults to identity                    |
| `onCommit(normalizedValue)`           | Feature-owned navigation or request                                             |

It returns `value`, `setValue`, `commitNow(value)`, and `discardDraft()`.
`setValue` arms the delay. Submit or clear calls `commitNow`, which cancels
the old timer and deduplicates the same canonical target. A sort/page link
calls `discardDraft` synchronously before navigating; this cancels the timer
and restores the current authoritative text. An already-in-flight latest
self echo remains recognizable after discard.

Only one latest expected identity is tracked. A matching authoritative view
consumes it without erasing a newer typed draft; a different view clears it,
resets the draft, and disarms the timer. The caller must ensure a newer
navigation/request prevents an older unapplied response from becoming the
view. The [navigation guide](./navigation-and-verification.md#reconcile-navigation)
explains the installed Next behavior and the exact-identity Back/Forward
limit. Do not use this controller directly with a transport that applies
superseded responses out of order.

## What the shared layer does not own

The feature owns query parameter names, server validation, result fetching,
sort/page defaults, complete canonical identity, no-JavaScript form, localized
copy, route-progress navigation, and discrete-link coordination. A Console
adapter must stay under `features/console-discovery`; another feature should
compose the shared imports through its own adapter.
