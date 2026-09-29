import { adminApiKeyListResponseSchema, type AdminApiKeyQuery } from '@amcore/shared'

import { fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

export function fetchConsoleApiKeys(query: AdminApiKeyQuery) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value))
  return fetchBackend(`/api/v1/admin/api-keys?${params}`, adminApiKeyListResponseSchema, {
    auth: 'required',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
