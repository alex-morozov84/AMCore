import { useCallback, useEffect, useRef, useState } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'

import { buildDiscoveryHref, type DiscoverySortOrder } from '../model/discovery-query'

const DEBOUNCE_MS = 300

export interface UseSearchNavigationOptions {
  baseHref: string
  defaultValue: string
  sortBy: string
  sortOrder?: DiscoverySortOrder
}

/**
 * Debounces a search draft, then navigates via
 * `useRouteProgressRouter().replace()` once it settles — the state machine
 * behind `SearchInput`, split out so that component stays a thin,
 * presentational form (AGENTS.md's <150-line file boundary).
 *
 * Every navigated value is trimmed first, matching the backend's own
 * `normalizeSearch` (`packages/shared/src/schemas/admin.ts`) exactly — so
 * the URL this writes is always what the server would echo back, never a
 * non-canonical `?search=+++` a raw draft would otherwise produce.
 */
export function useSearchNavigation({
  baseHref,
  defaultValue,
  sortBy,
  sortOrder,
}: UseSearchNavigationOptions) {
  const router = useRouteProgressRouter()
  const [value, setValue] = useState(defaultValue)
  const [syncedValue, setSyncedValue] = useState(defaultValue)
  const debounced = useDebouncedValue(value, DEBOUNCE_MS)
  // The dedup baseline for `navigate()`'s "don't re-issue an identical
  // `replace()`" check. Plain `useState`, not a ref: it must be updated
  // during the same render-time branch as the resync logic below (only for
  // a *genuinely external* change), which refs cannot safely do — React
  // only allows mutating `.current` from an effect or event handler, never
  // from the render body itself.
  const [lastNavigated, setLastNavigated] = useState(defaultValue)
  // Every value this component has itself asked the router to navigate to
  // and has not yet seen echoed back via `defaultValue`. A *value* Set, not
  // a single "most recent" value: two navigations can be outstanding at
  // once (type `a`, then `ab` before `a`'s response commits), and the
  // older one's eventual echo must still be recognized as self-initiated,
  // not mistaken for an external change — recognizing only the latest was
  // an exact gap an earlier version of this fix had (found in review).
  const pendingSelfValues = useRef<Set<string>>(new Set([defaultValue]))

  // The canonical URL changed from outside this component (Back/Forward, an
  // out-of-range recovery link, a sort-header click that also carries the
  // current search forward) — resync the local draft to it. Adjusted during
  // render, the React-documented way to reset state in response to a prop
  // change, not inside an effect (which would cause an extra, avoidable
  // render pass — react-hooks/set-state-in-effect).
  //
  // Critically, this must NOT fire merely because `defaultValue` caught up
  // with one of this component's *own* prior `navigate()` calls (an RSC
  // response committing) — otherwise a newer draft typed while that
  // navigation was still in flight gets silently erased by the now-stale
  // value it superseded. `pendingSelfValues` distinguishes the two: a
  // self-initiated echo is removed from the set (consumed) without
  // touching `value`/`lastNavigated`; a genuinely external change resyncs
  // both.
  if (defaultValue !== syncedValue) {
    setSyncedValue(defaultValue)
    if (pendingSelfValues.current.has(defaultValue)) {
      pendingSelfValues.current.delete(defaultValue)
    } else {
      setValue(defaultValue)
      setLastNavigated(defaultValue)
    }
  }

  const navigate = useCallback(
    (next: string) => {
      const canonical = next.trim()
      if (canonical === lastNavigated) return
      setLastNavigated(canonical)
      pendingSelfValues.current.add(canonical)
      router.replace(
        buildDiscoveryHref(baseHref, {
          search: canonical || undefined,
          sortBy,
          sortOrder,
          page: 1,
        }),
        { scroll: false }
      )
    },
    [baseHref, sortBy, sortOrder, router, lastNavigated]
  )

  useEffect(() => {
    // No mount guard needed: on first render `debounced === defaultValue
    // === lastNavigated`, so `navigate` itself already no-ops via the
    // equality check above.
    navigate(debounced)
    // `navigate` intentionally excluded: besides `lastNavigated` (which
    // changing alone must not re-fire this effect — only a new `debounced`
    // value should), it is re-created only when baseHref/sortBy/sortOrder
    // change, and those changes come with their own navigation already.
    // (`react-hooks/exhaustive-deps` only lints `.tsx` files in this
    // project's ESLint config, so no disable comment is needed here.)
  }, [debounced])

  return { value, setValue, navigateNow: navigate }
}
