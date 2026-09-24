'use client'

import { createContext, use } from 'react'

import type { DiscoverySortOrder } from '../model/discovery-query'

export interface DiscoverySearchContextValue {
  baseHref: string
  sortBy: string
  sortOrder?: DiscoverySortOrder
  value: string
  setValue: (value: string) => void
  commitNow: (value: string) => void
  discardDraft: () => void
}

export const DiscoverySearchContext = createContext<DiscoverySearchContextValue | null>(null)

export function useDiscoverySearch() {
  const context = use(DiscoverySearchContext)
  if (!context) throw new Error('Discovery search controls require DiscoverySearchBoundary')
  return context
}

export function useDiscoveryDraftDiscard() {
  return use(DiscoverySearchContext)?.discardDraft
}
