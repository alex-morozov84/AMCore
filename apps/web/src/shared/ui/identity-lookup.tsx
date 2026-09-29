'use client'

import { Input } from '@/shared/ui/input'

import { useIdentityLookup } from './use-identity-lookup'

export interface IdentityLookupItem {
  id: string
  name?: string
  email?: string
  slug?: string
}
export interface IdentityLookupCopy {
  lookupSearch: string
  lookupEmpty: string
  lookupSelect: string
  lookupError: string
  lookupRefine: string
  loading: string
}

interface IdentityLookupProps {
  inputId: string
  label: string
  searchItems: (term: string) => Promise<{ items: IdentityLookupItem[]; hasMore: boolean }>
  copy: IdentityLookupCopy
  onSelect: (id: string) => void
}

/** Optional name-first path; search text stays in a POST body, never browser history. */
export function IdentityLookup({
  inputId,
  label,
  copy,
  searchItems,
  onSelect,
}: IdentityLookupProps) {
  const { search, items, hasMore, error, busy, completed, find, change, dismiss } =
    useIdentityLookup(searchItems)

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={search}
          maxLength={80}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              find()
            }
          }}
          placeholder={copy.lookupSearch}
          className="min-w-0 flex-1 bg-background"
        />
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.loading}
        </p>
      )}
      {completed && !busy && !error && !items.length && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.lookupEmpty}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {copy.lookupError}
        </p>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(item.id)
                dismiss()
              }}
              aria-label={`${copy.lookupSelect}: ${item.name ?? item.email ?? item.slug ?? item.id}`}
              className="w-full cursor-pointer rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2"
            >
              <span>{item.name ?? item.email ?? item.slug ?? item.id}</span>
              {(item.email || item.slug) && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.email ?? item.slug}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.lookupRefine}
        </p>
      )}
    </div>
  )
}
