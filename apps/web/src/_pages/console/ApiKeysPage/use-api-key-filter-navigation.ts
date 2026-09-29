'use client'

import type { AdminApiKeyQuery } from '@amcore/shared'

import { buildDiscoveryHref, useDiscoveryDraftDiscard } from '@/features/console-discovery'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import { keyDiscoveryState } from './query-state'

export function useApiKeyFilterNavigation(query: AdminApiKeyQuery, baseHref: string) {
  const router = useRouteProgressRouter()
  const discardDraft = useDiscoveryDraftDiscard()
  return (patch: Partial<AdminApiKeyQuery>) => {
    discardDraft?.()
    router.push(buildDiscoveryHref(baseHref, keyDiscoveryState({ ...query, ...patch, page: 1 })))
  }
}
