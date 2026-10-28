import { headers } from 'next/headers'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

const API_URL = getBackendBaseUrl()

export type ConsoleAccessProbe =
  | { kind: 'admitted' }
  | { kind: 'denied'; status: 401 | 403 }
  | { kind: 'upstream-unavailable' }
  | { kind: 'indeterminate' }

/** A live, fail-closed policy probe shared by console pages and BFF handlers. */
export async function probeConsoleAccess(): Promise<ConsoleAccessProbe> {
  try {
    const accessToken = await getConsoleAwareAccessToken()
    return await probeConsoleAccessWithToken(
      typeof accessToken === 'object' && accessToken !== null
        ? accessToken.accessToken
        : accessToken,
      await headers(),
      typeof accessToken === 'object' && accessToken !== null
        ? accessToken.browserHeaders
        : undefined
    )
  } catch {
    return { kind: 'indeterminate' }
  }
}

/** Evaluates one server-held bearer credential without returning any identity data. */
export async function probeConsoleAccessWithToken(
  accessToken: string | null,
  source: Headers,
  bindingHeaders?: Record<string, string>
): Promise<ConsoleAccessProbe> {
  try {
    if (!accessToken) return { kind: 'denied', status: 401 }
    const upstream = await fetchBackendResponse(`${API_URL}/api/v1/admin/access`, source, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}`, ...bindingHeaders },
    })
    if (upstream.status === 204) return { kind: 'admitted' }
    if (upstream.status === 401 || upstream.status === 403) {
      return { kind: 'denied', status: upstream.status }
    }
    return upstream.status === 503 ? { kind: 'upstream-unavailable' } : { kind: 'indeterminate' }
  } catch {
    return { kind: 'indeterminate' }
  }
}

export function consoleAccessProbeStatus(result: ConsoleAccessProbe): 204 | 401 | 403 | 404 | 503 {
  if (result.kind === 'admitted') return 204
  if (result.kind === 'denied') return result.status
  return result.kind === 'upstream-unavailable' ? 503 : 404
}
