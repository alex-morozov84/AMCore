import { type AdminOverviewResponse, adminOverviewResponseSchema } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * Console Overview status. Always resolves to `DataOutcome<'success'>` with
 * a typed payload when the request itself succeeds — a degraded observed
 * instance (`readiness: 'not_ready'`) is still `'success'`, since the
 * endpoint reports it as data, not as an HTTP error. `DataOutcome`'s
 * `'unavailable'` here means the observation itself could not be fetched
 * (network error, timeout, an actual 5xx) — a different failure than an
 * observed-not-ready instance, and the two must render different copy.
 */
export function fetchConsoleOverview(): Promise<DataOutcome<AdminOverviewResponse>> {
  return fetchBackend('/api/v1/admin/overview', adminOverviewResponseSchema, {
    auth: 'required',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
