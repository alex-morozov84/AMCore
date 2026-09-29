import { adminAuditLookupResponseSchema } from '@amcore/shared'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'

export async function lookupConsoleIdentity(kind: 'user' | 'organization', search: string) {
  const response = await fetch(`/api${getConsolePublicApiPath('/audit/lookup')}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, search }),
  })
  if (!response.ok) throw new Error('Identity lookup unavailable')
  return adminAuditLookupResponseSchema.parse(await response.json())
}
