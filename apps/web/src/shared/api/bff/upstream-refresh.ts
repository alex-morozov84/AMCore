import type { UpstreamRefreshFn } from './session-vault.types'
import { extractCookieValue } from './set-cookie'
import { ACCESS_TOKEN_LIFETIME_MS } from './vault-constants'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const REFRESH_COOKIE_NAME = 'refresh_token'

/**
 * The real `UpstreamRefreshFn` for `ensureFreshSession` (ADR-068): calls
 * `apps/api`'s `POST /auth/refresh` server-to-server, presenting the vault's
 * stored refresh token as a `Cookie` header (the backend's
 * `RefreshTokenGuard` reads it from `request.cookies`, not a body — there is
 * no browser request to forward a real cookie from here). The backend
 * collapses every refresh failure mode (expired, invalid, reused) into the
 * same `401 TOKEN_INVALID` — no separate signal to distinguish reuse from a
 * plain invalid/expired token, so both map to `code: 'invalid'` here, which
 * is exactly the class `ensureFreshSession` treats as "delete the vault."
 * Anything else (network failure, 5xx, unexpected shape) is left uncoded,
 * so it's treated as transient per that same classification.
 */
export const upstreamRefresh: UpstreamRefreshFn = async (refreshToken, signal) => {
  const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}` },
    signal,
  })

  if (!response.ok) {
    const code = response.status === 401 ? 'invalid' : 'network'
    throw Object.assign(new Error(`Upstream refresh failed with status ${response.status}`), {
      code,
    })
  }

  const data = (await response.json()) as { accessToken: string }
  const rotatedRefreshToken = extractCookieValue(response, REFRESH_COOKIE_NAME)
  if (!rotatedRefreshToken) {
    throw Object.assign(new Error('Upstream refresh did not rotate the refresh_token cookie'), {
      code: 'invalid',
    })
  }

  return {
    accessToken: data.accessToken,
    accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_MS,
    refreshToken: rotatedRefreshToken,
  }
}
