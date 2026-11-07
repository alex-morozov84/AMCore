import { adminAuditLookupResponseSchema } from '@amcore/shared'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

export async function lookupConsoleIdentity(
  kind: 'user' | 'organization',
  search: string,
  signal?: AbortSignal
) {
  const response = await fetch(`/api${getConsolePublicApiPath('/audit/lookup')}`, {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, search }),
  })
  if (!response.ok) throw new Error('Identity lookup unavailable')
  return adminAuditLookupResponseSchema.parse(await response.json())
}
