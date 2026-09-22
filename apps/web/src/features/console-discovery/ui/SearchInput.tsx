'use client'

import { type FormEvent, useRef } from 'react'
import { Search, X } from 'lucide-react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import type { DiscoverySortOrder } from '../model/discovery-query'

import { useSearchNavigation } from './use-search-navigation'

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
 * The panel's one client island — the debounce/navigation state machine
 * lives in `useSearchNavigation`; this stays a thin, presentational form.
 * No `useSearchParams()` call here (state comes from props, already parsed
 * server-side), so no `<Suspense>` boundary is required for this component.
 *
 * Navigation uses `router.replace()`, not `push()` (see the hook): an
 * intermediate keystroke never adds a history entry — see
 * `docs/operations-console/README.md` for exactly what that does and does
 * not guarantee about the Back button.
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
  const { value, setValue, navigateNow } = useSearchNavigation({
    baseHref,
    defaultValue,
    sortBy,
    sortOrder,
  })
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigateNow(value)
  }

  function handleClear() {
    setValue('')
    navigateNow('')
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
          // Matches the backend's own `z.string().max(255)`
          // (`packages/shared/src/schemas/admin.ts`) — capped at the source
          // so a pasted overlong string can never silently become "no
          // filter" once normalized server-side.
          maxLength={255}
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
