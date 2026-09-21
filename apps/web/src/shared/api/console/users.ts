import { type AdminUserListResponse, adminUserListResponseSchema, PAGINATION } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * Read-only user inventory for the Operations Console. The existing admin
 * endpoint already excludes credentials and internal normalization data.
 */
export function fetchConsoleUsers(
  page: number = PAGINATION.DEFAULT_PAGE,
  limit: number = PAGINATION.DEFAULT_LIMIT
): Promise<DataOutcome<AdminUserListResponse>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  return fetchBackend(`/api/v1/admin/users?${params.toString()}`, adminUserListResponseSchema, {
    auth: 'required',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
