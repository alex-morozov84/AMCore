'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { IdentityLookupItem } from './identity-lookup'

import 'client-only'

export function useIdentityLookup(
  searchItems: (
    term: string,
    signal?: AbortSignal
  ) => Promise<{ items: IdentityLookupItem[]; hasMore: boolean }>
) {
  const instance = useId()
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [intent, setIntent] = useState<{ term: string; dismissed: boolean } | null>(null)
  const debounce = useRef<number | undefined>(undefined)
  const active = intent !== null && !intent.dismissed
  const query = useQuery({
    queryKey: active
      ? ['identity-lookup', instance, revision, intent.term]
      : ['identity-lookup', instance, 'idle'],
    queryFn: ({ signal }) => searchItems(intent?.term ?? '', signal),
    enabled: active,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: 'always',
    placeholderData: undefined,
  })

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) return
    debounce.current = window.setTimeout(() => {
      setIntent((current) => current ?? { term, dismissed: false })
    }, 400)
    return () => window.clearTimeout(debounce.current)
  }, [search, revision])

  function find() {
    const term = search.trim()
    if (term.length < 2) return
    window.clearTimeout(debounce.current)
    if (intent?.term === term) {
      if (!intent.dismissed && query.isError) void query.refetch()
      return
    }
    setIntent({ term, dismissed: false })
  }
  function change(value: string) {
    window.clearTimeout(debounce.current)
    setSearch(value)
    setRevision((current) => current + 1)
    setIntent(null)
  }
  function dismiss() {
    window.clearTimeout(debounce.current)
    setIntent((current) => current && { ...current, dismissed: true })
  }
  return {
    search,
    items: active ? (query.data?.items ?? []) : [],
    hasMore: active && (query.data?.hasMore ?? false),
    error: active && query.isError,
    busy: active && query.isFetching,
    completed: active && query.isSuccess,
    find,
    change,
    dismiss,
  }
}
