'use client'

import type { ComponentProps } from 'react'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { useDiscoveryDraftDiscard } from './discovery-search-context'

export type DiscoveryNavigationLinkProps = Omit<
  ComponentProps<typeof RouteProgressLink>,
  'onNavigate'
>

/** A discrete discovery action wins over any search draft whose debounce has not fired. */
export function DiscoveryNavigationLink(props: DiscoveryNavigationLinkProps) {
  const discardDraft = useDiscoveryDraftDiscard()
  return <RouteProgressLink {...props} onNavigate={discardDraft} />
}
