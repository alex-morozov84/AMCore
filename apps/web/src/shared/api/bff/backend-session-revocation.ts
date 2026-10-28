import type { BrowserAudience } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import {
  browserSessionHeaders,
  changedBrowserContext,
  unavailableBrowserContext,
} from './browser-binding.server'
import type { VaultRecord } from './session-vault.types'

import 'server-only'

const API_URL = getBackendBaseUrl()

/** Confirm exact primary generation retirement before claiming browser logout. Never falls back to legacy refresh revocation. */
export async function logoutBoundBrowserSession(
  entry: VaultRecord,
  source: Headers,
  audience: BrowserAudience
): Promise<void> {
  const binding = browserSessionHeaders(source, audience, entry)
  let response: Response
  try {
    response = await fetchBackendResponse(`${API_URL}/api/v1/auth/logout`, source, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { ...binding, Cookie: `refresh_token=${entry.refreshToken}` },
    })
  } catch {
    throw unavailableBrowserContext()
  }
  if ([401, 403, 409].includes(response.status)) throw changedBrowserContext()
  if (response.status !== 204) throw unavailableBrowserContext()
}

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
