'use client'

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { buildDiscoveryHref, type DiscoverySortOrder } from '../model/discovery-query'

const DEBOUNCE_MS = 300

export interface SearchInputProps {
  /** The panel's own locale-aware path, e.g. `getConsoleUsersHref()`. */
  baseHref: string
  /** The current `search` value from the server-parsed URL — the source of truth. */
  defaultValue: string
  /** Current sort state, carried forward unchanged by every search navigation. */
  sortBy: string
  sortOrder?: DiscoverySortOrder
  label: string
  placeholder: string
  clearLabel: string
  inputId: string
  className?: string
}

/**
 * The panel's one client island. Debounces typing, then navigates via
 * `useRouteProgressRouter().replace()` — never a raw router call, which the
 * repository's own lint rule already forbids outside that hook. No
 * `useSearchParams()` call here (state comes from props, already parsed
 * server-side), so no `<Suspense>` boundary is required for this component.
 *
 * `replace`, not `push`: an intermediate keystroke should not create a
 * history entry — only a value the operator actually pauses/submits on is
 * worth a Back-button stop.
 */
export function SearchInput({
  baseHref,
  defaultValue,
  sortBy,
  sortOrder,
  label,
  placeholder,
  clearLabel,
  inputId,
  className,
}: SearchInputProps) {
  const router = useRouteProgressRouter()
  const [value, setValue] = useState(defaultValue)
  const [syncedValue, setSyncedValue] = useState(defaultValue)
  const debounced = useDebouncedValue(value, DEBOUNCE_MS)
  const lastNavigated = useRef(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // The canonical URL changed from outside this component (Back/Forward,
  // an out-of-range recovery link, a sort-header click that also carries
  // the current search forward) — resync the local draft to it. Adjusted
  // during render, the React-documented way to reset state in response to
  // a prop change, not inside an effect (which would cause an extra,
  // avoidable render pass — react-hooks/set-state-in-effect).
  if (defaultValue !== syncedValue) {
    setSyncedValue(defaultValue)
    setValue(defaultValue)
  }

  // Refs may not be mutated during render (unlike the setState calls
  // above, which React explicitly allows for this exact derived-from-
  // props-reset pattern) — kept in its own effect, separate from the
  // debounce-triggering one below, so it never calls setState itself.
  useEffect(() => {
    lastNavigated.current = defaultValue
  }, [defaultValue])

  const navigate = useCallback(
    (next: string) => {
      if (next === lastNavigated.current) return
      lastNavigated.current = next
      router.replace(
        buildDiscoveryHref(baseHref, { search: next || undefined, sortBy, sortOrder, page: 1 }),
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
    // alone would fire a redundant duplicate navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate(value)
  }

  function handleClear() {
    setValue('')
    navigate('')
    // The button itself unmounts once `value` clears — without this, focus
    // would fall back to the document instead of staying in the field the
    // operator was just typing into.
    inputRef.current?.focus()
  }

  return (
    <form
      method="GET"
      action={baseHref}
      onSubmit={handleSubmit}
      role="search"
      className={cn('flex items-center gap-2', className)}
    >
      <Label htmlFor={inputId} className="sr-only">
        {label}
      </Label>
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-muted"
        />
        <Input
          ref={inputRef}
          id={inputId}
          name="search"
          // Deliberately `text`, not `search`: `type="search"` adds the
          // browser's own native clear button (WebKit/Blink), which then
          // sits right next to ours — two clear affordances doing the same
          // thing, one of them unstyled and inconsistent across browsers.
          // One custom, consistently-styled clear button below is enough.
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="pr-8 pl-8"
          autoComplete="off"
        />
        {/* Hidden fields carry the current sort forward for the no-JS GET
            fallback — the debounced/client navigation builds its own href
            and never actually submits this form when JS is active. */}
        <input type="hidden" name="sortBy" value={sortBy} />
        {sortOrder && <input type="hidden" name="sortOrder" value={sortOrder} />}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleClear}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <X aria-hidden="true" />
            <span className="sr-only">{clearLabel}</span>
          </Button>
        )}
      </div>
    </form>
  )
}
