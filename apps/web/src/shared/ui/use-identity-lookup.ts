'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { IdentityLookupItem } from './identity-lookup'

import 'client-only'

export function useIdentityLookup(
  searchItems: (term: string) => Promise<{ items: IdentityLookupItem[]; hasMore: boolean }>
) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<
    Array<{ id: string; name?: string; email?: string; slug?: string }>
  >([])
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const sequence = useRef(0)
  const debounce = useRef<number | undefined>(undefined)
  const lastRequested = useRef('')

  const lookup = useCallback(
    async (term: string) => {
      if (lastRequested.current === term) return
      lastRequested.current = term
      const requestNumber = ++sequence.current
      setBusy(true)
      setCompleted(false)
      setError(false)
      setItems([])
      try {
        const parsed = await searchItems(term)
        if (requestNumber === sequence.current) {
          setCompleted(true)
          setItems(parsed.items)
          setHasMore(parsed.hasMore)
        }
      } catch {
        if (requestNumber === sequence.current) {
          lastRequested.current = ''
          setError(true)
        }
      } finally {
        if (requestNumber === sequence.current) setBusy(false)
      }
    },
    [searchItems]
  )

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) return
    debounce.current = window.setTimeout(() => void lookup(term), 400)
    return () => window.clearTimeout(debounce.current)
  }, [lookup, search])

  function find() {
    const term = search.trim()
    if (term.length < 2) return
    window.clearTimeout(debounce.current)
    void lookup(term)
  }
  function change(value: string) {
    sequence.current += 1
    lastRequested.current = ''
    setSearch(value)
    setItems([])
    setHasMore(false)
    setBusy(false)
    setError(false)
    setCompleted(false)
  }
  function dismiss() {
    sequence.current += 1
    window.clearTimeout(debounce.current)
    setItems([])
    setHasMore(false)
    setBusy(false)
    setCompleted(false)
  }
  return { search, items, hasMore, error, busy, completed, find, change, dismiss }
}
