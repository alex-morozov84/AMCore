import { workCatalogueSchema, type WorkSummary } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

export function fetchConsoleBackgroundWork(): Promise<DataOutcome<WorkSummary[]>> {
  return fetchBackend('/api/v1/admin/background-work/works', workCatalogueSchema, {
    auth: 'required',
    cache: 'no-store',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
