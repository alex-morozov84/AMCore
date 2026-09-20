import {
  type AdminOrganizationListResponse,
  adminOrganizationListResponseSchema,
  PAGINATION,
} from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * Read-only organizations list for the console Organizations panel — no
 * detail endpoint exists on the backend, so this is the whole contract.
 * Uses the console's own token source (`getConsoleAwareAccessToken`), never
 * the product session, so a console viewer's data is always console-scoped
 * even in path mode.
 */
export function fetchConsoleOrganizations(
  page: number = PAGINATION.DEFAULT_PAGE,
  limit: number = PAGINATION.DEFAULT_LIMIT
): Promise<DataOutcome<AdminOrganizationListResponse>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  return fetchBackend(
    `/api/v1/admin/organizations?${params.toString()}`,
    adminOrganizationListResponseSchema,
    { auth: 'required', tokenResolver: getConsoleAwareAccessToken }
  )
}
