'use client'

import type { FormEvent } from 'react'

import { cn } from '@/shared/lib/utils'
import { SearchField } from '@/shared/ui/search-field'

import { useDiscoverySearch } from './discovery-search-context'

export interface SearchInputProps {
  label: string
  placeholder: string
  clearLabel: string
  inputId: string
  className?: string
}

/**
 * Console-specific GET form over the shared field and draft controller.
 * The surrounding `DiscoverySearchBoundary` owns navigation state.
 * No `useSearchParams()` call here (state comes from props, already parsed
 * server-side), so no `<Suspense>` boundary is required for this component.
 *
 * Navigation uses `router.replace()`, not `push()` (see the hook): an
 * intermediate keystroke never adds a history entry — see
 * `docs/frontend/search/navigation-and-verification.md` for the precise
 * Back/Forward limits of URL-backed search.
 */
export function SearchInput({
  label,
  placeholder,
  clearLabel,
  inputId,
  className,
}: SearchInputProps) {
  const { baseHref, sortBy, sortOrder, value, setValue, commitNow } = useDiscoverySearch()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    commitNow(value)
  }

  function handleClear() {
    setValue('')
    commitNow('')
  }

  return (
    <form
      method="GET"
      action={baseHref}
      onSubmit={handleSubmit}
      role="search"
      className={cn('flex items-center gap-2', className)}
    >
      <SearchField
        id={inputId}
        name="search"
        value={value}
        onValueChange={setValue}
        onClear={handleClear}
        label={label}
        placeholder={placeholder}
        clearLabel={clearLabel}
        maxLength={255}
      />
      {/* Hidden fields carry the current sort forward for the no-JS GET
          fallback — client navigation builds its own href instead. */}
      <input type="hidden" name="sortBy" value={sortBy} />
      {sortOrder && <input type="hidden" name="sortOrder" value={sortOrder} />}
    </form>
  )
}
