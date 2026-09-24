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
  baseHref: string
  search?: string
  page: number
  sortBy: string
  sortOrder?: DiscoverySortOrder
  effectiveSortOrder: DiscoverySortOrder
  children: ReactNode
}

type ControllerProps = Omit<DiscoverySearchBoundaryProps, 'children'>
type CommitIdentityProps = Pick<ControllerProps, 'baseHref' | 'sortBy' | 'effectiveSortOrder'>
type SearchCommitProps = Pick<ControllerProps, 'baseHref' | 'sortBy' | 'sortOrder'>

function useCommitIdentity({ baseHref, sortBy, effectiveSortOrder }: CommitIdentityProps) {
  return useCallback(
    (value: string) =>
      buildDiscoveryIdentity(baseHref, {
        search: value || undefined,
        page: 1,
        sortBy,
        effectiveSortOrder,
      }),
    [baseHref, effectiveSortOrder, sortBy]
  )
}

function useSearchCommit({ baseHref, sortBy, sortOrder }: SearchCommitProps) {
  const router = useRouteProgressRouter()
  return useCallback(
    (value: string) => {
      const state = { search: value || undefined, sortBy, sortOrder, page: 1 }
      router.replace(buildDiscoveryHref(baseHref, state), { scroll: false })
    },
    [baseHref, router, sortBy, sortOrder]
  )
}

function useDiscoverySearchController({
  baseHref,
  search = '',
  page,
  sortBy,
  sortOrder,
  effectiveSortOrder,
}: ControllerProps) {
  const authoritativeIdentity = buildDiscoveryIdentity(baseHref, {
    search: search || undefined,
    page,
    sortBy,
    effectiveSortOrder,
  })
  const getCommitIdentity = useCommitIdentity({ baseHref, sortBy, effectiveSortOrder })
  const onCommit = useSearchCommit({ baseHref, sortBy, sortOrder })

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
  const { baseHref, sortBy, sortOrder, children } = props
  const controller = useDiscoverySearchController(props)
  const context = useMemo(
    () => ({ baseHref, sortBy, sortOrder, ...controller }),
    [baseHref, controller, sortBy, sortOrder]
  )

  return <DiscoverySearchContext value={context}>{children}</DiscoverySearchContext>
}
