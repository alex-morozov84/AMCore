import type { InviteListQuery } from '@amcore/shared'

export type InvitationListView = Pick<InviteListQuery, 'page' | 'search' | 'status'>
export function invitationListHref(base: string, query: InvitationListView) {
  const params = new URLSearchParams()
  if (query.search) params.set('search', query.search)
  if (query.status !== 'pending') params.set('status', query.status)
  if (query.page > 1) params.set('page', String(query.page))
  return params.size ? `${base}?${params}` : base
}
