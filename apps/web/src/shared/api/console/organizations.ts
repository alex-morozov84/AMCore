import {
  type AdminOrganizationDetailResponse,
  adminOrganizationDetailResponseSchema,
  type AdminOrganizationListResponse,
  adminOrganizationListResponseSchema,
  type AdminOrganizationSortField,
  type AdminSortOrder,
  PAGINATION,
} from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

export interface FetchConsoleOrganizationsParams {
  page?: number
  limit?: number
  search?: string
  sortBy?: AdminOrganizationSortField
  sortOrder?: AdminSortOrder
}

export function fetchConsoleOrganizationDetail(
  id: string,
  page: number,
  search?: string,
  limit = PAGINATION.DEFAULT_LIMIT
): Promise<DataOutcome<AdminOrganizationDetailResponse>> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) query.set('search', search)
  return fetchBackend(
    `/api/v1/admin/organizations/${encodeURIComponent(id)}?${query}`,
    adminOrganizationDetailResponseSchema,
    {
      auth: 'required',
      tokenResolver: getConsoleAwareAccessToken,
    }
  )
}

/**
 * Read-only organizations list for the console Organizations panel — no
 * detail endpoint exists on the backend, so this is the whole contract.
 * Uses the console's own token source (`getConsoleAwareAccessToken`), never
 * the product session, so a console viewer's data is always console-scoped
 * even in path mode. `search`/`sortBy`/`sortOrder` are forwarded as-is —
 * already allowlisted/normalized by the route's own searchParams parsing
 * before reaching this function, so no additional validation happens here.
 */
export function fetchConsoleOrganizations(
  params: FetchConsoleOrganizationsParams = {}
): Promise<DataOutcome<AdminOrganizationListResponse>> {
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
  return fetchBackend(
    `/api/v1/admin/organizations?${query.toString()}`,
    adminOrganizationListResponseSchema,
    { auth: 'required', tokenResolver: getConsoleAwareAccessToken }
  )
}
