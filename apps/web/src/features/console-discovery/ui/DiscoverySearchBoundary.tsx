'use client'

import { type ReactNode, useCallback, useMemo } from 'react'

import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { useDebouncedDraft } from '@/shared/lib/use-debounced-draft'

import { buildDiscoveryIdentity } from '../model/discovery-identity'
import { buildDiscoveryHref, type DiscoverySortOrder } from '../model/discovery-query'

import { DiscoverySearchContext } from './discovery-search-context'

const DEBOUNCE_MS = 300
const normalizeSearch = (value: string) => value.trim()

export interface DiscoverySearchBoundaryProps {
  extraQuery?: Readonly<Record<string, string | undefined>>
  baseHref: string
  search?: string
  page: number
  sortBy: string
  sortOrder?: DiscoverySortOrder
  effectiveSortOrder: DiscoverySortOrder
  children: ReactNode
}

type ControllerProps = Omit<DiscoverySearchBoundaryProps, 'children'>
type CommitIdentityProps = Pick<
  ControllerProps,
  'baseHref' | 'sortBy' | 'effectiveSortOrder' | 'extraQuery'
>
type SearchCommitProps = Pick<ControllerProps, 'baseHref' | 'sortBy' | 'sortOrder' | 'extraQuery'>

function useCommitIdentity({
  baseHref,
  sortBy,
  effectiveSortOrder,
  extraQuery,
}: CommitIdentityProps) {
  return useCallback(
    (value: string) =>
      buildDiscoveryIdentity(baseHref, {
        extraQuery,
        search: value || undefined,
        page: 1,
        sortBy,
        effectiveSortOrder,
      }),
    [baseHref, effectiveSortOrder, sortBy, extraQuery]
  )
}

function useSearchCommit({ baseHref, sortBy, sortOrder, extraQuery }: SearchCommitProps) {
  const router = useRouteProgressRouter()
  return useCallback(
    (value: string) => {
      const state = { extraQuery, search: value || undefined, sortBy, sortOrder, page: 1 }
      router.replace(buildDiscoveryHref(baseHref, state), { scroll: false })
    },
    [baseHref, router, sortBy, sortOrder, extraQuery]
  )
}

function useDiscoverySearchController({
  baseHref,
  extraQuery,
  search = '',
  page,
  sortBy,
  sortOrder,
  effectiveSortOrder,
}: ControllerProps) {
  const authoritativeIdentity = buildDiscoveryIdentity(baseHref, {
    extraQuery,
    search: search || undefined,
    page,
    sortBy,
    effectiveSortOrder,
  })
  const getCommitIdentity = useCommitIdentity({ baseHref, sortBy, effectiveSortOrder, extraQuery })
  const onCommit = useSearchCommit({ baseHref, sortBy, sortOrder, extraQuery })

  return useDebouncedDraft({
    authoritativeValue: search,
    authoritativeIdentity,
    getCommitIdentity,
    delayMs: DEBOUNCE_MS,
    normalize: normalizeSearch,
    onCommit,
  })
}

export function DiscoverySearchBoundary(props: DiscoverySearchBoundaryProps) {
  const { baseHref, sortBy, sortOrder, extraQuery, children } = props
  const controller = useDiscoverySearchController(props)
  const context = useMemo(
    () => ({ baseHref, sortBy, sortOrder, extraQuery, ...controller }),
    [baseHref, controller, sortBy, sortOrder, extraQuery]
  )

  return <DiscoverySearchContext value={context}>{children}</DiscoverySearchContext>
}
