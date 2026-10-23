import { type IntegrationsResponse, integrationsResponseSchema } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * First snapshot of the Integrations screen. An unreadable integration is typed data inside a
 * successful response; `DataOutcome`'s `unavailable` means this request itself failed.
 */
export function fetchConsoleIntegrations(): Promise<DataOutcome<IntegrationsResponse>> {
  return fetchBackend('/api/v1/admin/integrations', integrationsResponseSchema, {
    auth: 'required',
    cache: 'no-store',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
