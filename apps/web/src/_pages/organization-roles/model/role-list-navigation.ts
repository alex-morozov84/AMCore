export interface RoleListView {
  search: string
  page: number
}

/** The caller owns the locale-neutral placement; this module only encodes the view. */
export function roleListHref(baseHref: string, query: RoleListView) {
  const params = new URLSearchParams()
  if (query.search) params.set('search', query.search)
  if (query.page > 1) params.set('page', String(query.page))
  return params.size ? `${baseHref}?${params}` : baseHref
}
