import {
  buildDiscoveryHref,
  type DiscoveryQueryState,
  type DiscoverySortOrder,
} from './discovery-query'

export interface DiscoveryIdentityState extends Omit<DiscoveryQueryState, 'sortOrder'> {
  effectiveSortOrder: DiscoverySortOrder
}

/** Full canonical view identity; unlike the public URL it always includes effective sort direction. */
export function buildDiscoveryIdentity(
  baseHref: string,
  { effectiveSortOrder, ...state }: DiscoveryIdentityState
) {
  return buildDiscoveryHref(baseHref, { ...state, sortOrder: effectiveSortOrder })
}
