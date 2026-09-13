import { getBackendAccessToken } from '@/shared/api/server/access-token'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { getConsoleAccessToken } from './session'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

export type ConsoleAccessStatus = 204 | 401 | 403 | 503

/** A live, fail-closed policy probe shared by console pages and BFF handlers. */
export async function probeConsoleAccess(): Promise<ConsoleAccessStatus> {
  try {
    const accessToken =
      ADMIN_CONSOLE_CONFIG.mode === 'host'
        ? await getConsoleAccessToken()
        : await getBackendAccessToken()
    return await probeConsoleAccessWithToken(accessToken)
  } catch {
    return 503
  }
}

/** Evaluates one server-held bearer credential without returning any identity data. */
export async function probeConsoleAccessWithToken(
  accessToken: string | null
): Promise<ConsoleAccessStatus> {
  try {
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
