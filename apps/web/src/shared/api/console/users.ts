import {
  type AdminSortOrder,
  type AdminUserListResponse,
  adminUserListResponseSchema,
  type AdminUserSortField,
  PAGINATION,
} from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

export interface FetchConsoleUsersParams {
  page?: number
  limit?: number
  search?: string
  sortBy?: AdminUserSortField
  sortOrder?: AdminSortOrder
}

/**
 * Read-only user inventory for the Operations Console. The existing admin
 * endpoint already excludes credentials and internal normalization data.
 * `search`/`sortBy`/`sortOrder` are forwarded as-is — they are already
 * allowlisted/normalized by the route's own searchParams parsing before
 * reaching this function, so no additional validation happens here.
 */
export function fetchConsoleUsers(
  params: FetchConsoleUsersParams = {}
): Promise<DataOutcome<AdminUserListResponse>> {
  const {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    search,
    sortBy,
    sortOrder,
  } = params
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) query.set('search', search)
  if (sortBy) query.set('sortBy', sortBy)
  if (sortOrder) query.set('sortOrder', sortOrder)
  return fetchBackend(`/api/v1/admin/users?${query.toString()}`, adminUserListResponseSchema, {
    auth: 'required',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
