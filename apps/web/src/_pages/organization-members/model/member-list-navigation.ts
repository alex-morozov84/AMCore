export interface MemberListView {
  search: string
  page: number
}

/** The caller owns the locale-neutral placement; this module only encodes the view. */
export function memberListHref(baseHref: string, query: MemberListView) {
  const params = new URLSearchParams()
  if (query.search) params.set('search', query.search)
  if (query.page > 1) params.set('page', String(query.page))
  return params.size ? `${baseHref}?${params}` : baseHref
}
