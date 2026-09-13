import { getBackendAccessToken } from '@/shared/api/server/access-token'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export type ConsoleAccessStatus = 204 | 401 | 403 | 503

/** A live, fail-closed policy probe shared by console pages and BFF handlers. */
export async function probeConsoleAccess(): Promise<ConsoleAccessStatus> {
  try {
    const accessToken = await getBackendAccessToken()
    if (!accessToken) return 401

    const upstream = await fetch(`${API_URL}/api/v1/admin/access`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const status = upstream.status
    return status === 204 || status === 401 || status === 403 ? status : 503
  } catch {
    return 503
  }
}
