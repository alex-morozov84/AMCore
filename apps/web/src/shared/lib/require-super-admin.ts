import { cache } from 'react'
import { notFound } from 'next/navigation'

import { getBackendAccessToken } from '@/shared/api/server/access-token'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/**
 * React `cache` is request-scoped for a Server Component render. It avoids a
 * duplicate live probe during one render without retaining a role decision for
 * a later request.
 */
export const requireSuperAdmin = cache(async (): Promise<void> => {
  const accessToken = await getBackendAccessToken()
  if (!accessToken) notFound()

  let response: Response
  try {
    response = await fetch(`${API_URL}/api/v1/admin/access`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    notFound()
  }

  if (response.status !== 204) notFound()
})
