'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminAuditLookupResponseSchema } from '@amcore/shared'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

import type { AuditCopy } from './audit-copy'

interface AuditLookupProps {
  kind: 'user' | 'organization'
  copy: AuditCopy
  onSelect: (id: string) => void
}

/** Optional name-first path; search text stays in a POST body, never browser history. */
export function AuditLookup({ kind, copy, onSelect }: AuditLookupProps) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<
    Array<{ id: string; name?: string; email?: string; slug?: string }>
  >([])
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)

  const lookup = useCallback(
    async (term: string) => {
      const requestNumber = ++sequence.current
      setBusy(true)
      setError(false)
      setItems([])
      try {
        const response = await fetch(`/api${getConsolePublicApiPath('/audit/lookup')}`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, search: term }),
        })
        if (!response.ok) throw Error()
        const parsed = adminAuditLookupResponseSchema.parse(await response.json())
        if (requestNumber === sequence.current) {
          setItems(parsed.items)
          setHasMore(parsed.hasMore)
        }
      } catch {
        if (requestNumber === sequence.current) setError(true)
      } finally {
        if (requestNumber === sequence.current) setBusy(false)
      }
    },
    [kind]
  )

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) return
    const timer = window.setTimeout(() => void lookup(term), 400)
    return () => window.clearTimeout(timer)
  }, [lookup, search])

  const label = kind === 'user' ? copy.lookupUser : copy.lookupOrganization
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <label htmlFor={`audit-lookup-${kind}`} className="block text-sm font-medium">
        {label}
      </label>
      <div>
        <input
          id={`audit-lookup-${kind}`}
          value={search}
          maxLength={80}
          onChange={(event) => {
            sequence.current += 1
            setSearch(event.target.value)
            setItems([])
            setHasMore(false)
            setBusy(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
          placeholder={copy.lookupSearch}
          className="w-full rounded-md border border-input bg-background px-3 py-2"
        />
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.loading}
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
                setItems([])
              }}
              aria-label={`${copy.lookupSelect}: ${item.name ?? item.email ?? item.slug ?? item.id}`}
              className="w-full rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2"
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
