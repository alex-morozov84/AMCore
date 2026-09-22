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
  const lastNavigated = useRef(defaultValue)

  // The canonical URL changed from outside this component (Back/Forward, an
  // out-of-range recovery link, a sort-header click that also carries the
  // current search forward) — resync the local draft to it. Adjusted during
  // render, the React-documented way to reset state in response to a prop
  // change, not inside an effect (which would cause an extra, avoidable
  // render pass — react-hooks/set-state-in-effect).
  //
  // Critically, this must NOT fire merely because `defaultValue` caught up
  // with this component's *own* last `navigate()` call (the RSC response
  // for an earlier keystroke committing) — otherwise a newer draft typed
  // while that navigation was still in flight gets silently erased by the
  // now-stale value it superseded. `lastNavigated` distinguishes the two:
  // it already equals `defaultValue` when this is just that self-initiated
  // navigation catching up.
  if (defaultValue !== syncedValue) {
    setSyncedValue(defaultValue)
    if (defaultValue !== lastNavigated.current) {
      setValue(defaultValue)
    }
  }

  // Refs may not be mutated during render (unlike the setState calls above,
  // which React explicitly allows for this exact derived-from-props-reset
  // pattern) — kept in its own effect, separate from the debounce-triggering
  // one below, so it never calls setState itself.
  useEffect(() => {
    lastNavigated.current = defaultValue
  }, [defaultValue])

  const navigate = useCallback(
    (next: string) => {
      const canonical = next.trim()
      if (canonical === lastNavigated.current) return
      lastNavigated.current = canonical
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
    [baseHref, sortBy, sortOrder, router]
  )

  useEffect(() => {
    // No mount guard needed: on first render `debounced === defaultValue
    // === lastNavigated.current`, so `navigate` itself already no-ops via
    // the equality check above.
    navigate(debounced)
    // `navigate` intentionally excluded: it is re-created only when
    // baseHref/sortBy/sortOrder change, and those changes come with their
    // own navigation already — re-running this effect for that reason
    // alone would fire a redundant duplicate navigate. (`react-hooks/
    // exhaustive-deps` only lints `.tsx` files in this project's ESLint
    // config, so no disable comment is needed in this plain `.ts` hook.)
  }, [debounced])

  return { value, setValue, navigateNow: navigate }
}
