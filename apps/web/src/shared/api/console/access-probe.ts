import { getBackendAccessToken } from '@/shared/api/server/access-token'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export async function proxyConsoleAccessProbe(): Promise<Response> {
  const accessToken = await getBackendAccessToken()
  if (!accessToken) return new Response(null, { status: 401 })

  try {
    const upstream = await fetch(`${API_URL}/api/v1/admin/access`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const status = upstream.status
    if (status === 204 || status === 401 || status === 403) {
      return new Response(null, { status })
    }
    return new Response(null, { status: 503 })
  } catch {
    return new Response(null, { status: 503 })
  }
}
