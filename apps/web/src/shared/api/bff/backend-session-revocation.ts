import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import 'server-only'

const API_URL = getBackendBaseUrl()

/** Revokes a server-held backend refresh session without exposing it to the browser. */
export async function revokeBackendSession(refreshToken: string, source: Headers): Promise<void> {
  try {
    const response = await fetchBackendResponse(`${API_URL}/api/v1/auth/logout`, source, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { Cookie: `refresh_token=${refreshToken}` },
    })
    if (!response.ok) console.error(`[bff] backend logout returned status ${response.status}`)
  } catch {
    console.error('[bff] backend logout failed', { category: 'transport' })
  }
}
