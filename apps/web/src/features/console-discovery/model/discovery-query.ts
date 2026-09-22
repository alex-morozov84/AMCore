export type DiscoverySortOrder = 'asc' | 'desc'

export interface DiscoveryQueryState {
  search?: string
  sortBy: string
  sortOrder?: DiscoverySortOrder
  page: number
}

/**
 * Builds the canonical URL for a discovery panel (search/sort/page), given
 * the full desired state — never a partial merge, so every call site states
 * exactly what it means to change and what it means to preserve. `sortOrder`
 * is only ever written once an operator has toggled a sort header; omitted
 * otherwise, so the URL stays untouched (relying on the API's own default
 * direction) until the operator actually interacts with sort.
 */
export function buildDiscoveryHref(baseHref: string, state: DiscoveryQueryState): string {
  const params = new URLSearchParams()
  if (state.search) params.set('search', state.search)
  params.set('sortBy', state.sortBy)
  if (state.sortOrder) params.set('sortOrder', state.sortOrder)
  if (state.page > 1) params.set('page', String(state.page))
  const query = params.toString()
  return query ? `${baseHref}?${query}` : baseHref
}

/**
 * Resolves the sort direction a click on `column`'s header should navigate
 * to: switching to a not-yet-active column starts at its own default
 * direction; clicking the already-active column toggles it.
 */
export function toggleSortOrder(
  column: string,
  current: Pick<DiscoveryQueryState, 'sortBy' | 'sortOrder'>,
  defaultOrderForColumn: DiscoverySortOrder
): DiscoverySortOrder {
  if (column !== current.sortBy) return defaultOrderForColumn
  const effective = current.sortOrder ?? defaultOrderForColumn
  return effective === 'asc' ? 'desc' : 'asc'
}

/**
 * The `aria-sort` value for `column`'s header, given the current sort
 * state — `undefined` (the attribute omitted entirely) for an inactive
 * column, never the literal string `"none"`: only the currently-sorted
 * header should carry `aria-sort` at all.
 */
export function ariaSortValue(
  column: string,
  current: Pick<DiscoveryQueryState, 'sortBy' | 'sortOrder'>,
  defaultOrderForColumn: DiscoverySortOrder
): 'ascending' | 'descending' | undefined {
  if (column !== current.sortBy) return undefined
  const effective = current.sortOrder ?? defaultOrderForColumn
  return effective === 'asc' ? 'ascending' : 'descending'
}
