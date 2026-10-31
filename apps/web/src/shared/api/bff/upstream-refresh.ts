import type { BrowserAudience } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { browserSessionHeaders } from './browser-binding.server'
import { ContextRequestError } from './context-errors'
import { UpstreamRotationUnprovenError } from './errors'
import type { ProductWebContext } from './product-web-context.server'
import { sessionMetadataHeaders } from './session-metadata-headers'
import type { UpstreamRefreshFn } from './session-vault.types'
import { extractCookieValue } from './set-cookie'
import { ACCESS_TOKEN_LIFETIME_MS } from './vault-constants'

import 'server-only'

const API_URL = getBackendBaseUrl()
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
 * Network failures and non-401 responses carry `code: 'network'`, so callers
 * can distinguish known authentication-infrastructure unavailability from an
 * unrelated implementation defect. Unexpected response shapes stay uncoded.
 */
export function createUpstreamRefresh(
  source: Headers,
  context?: ProductWebContext,
  audience: BrowserAudience = context?.audience ?? 'product'
): UpstreamRefreshFn {
  const originalSource = new Headers(source)
  const metadata = { ...sessionMetadataHeaders(originalSource), ...context?.apiHeaders }
  return async (refreshToken, signal, browser) => {
    const bindingHeaders = browserSessionHeaders(originalSource, audience, { browser, audience })
    let response: Response
    try {
      response = await fetchBackendResponse(`${API_URL}/api/v1/auth/refresh`, originalSource, {
        method: 'POST',
        headers: {
          ...metadata,
          ...bindingHeaders,
          Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
        },
        signal,
      })
    } catch (cause) {
      throw Object.assign(new Error('Upstream refresh request failed', { cause }), {
        code: signal.aborted ? ('timeout' as const) : ('network' as const),
      })
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      const errorCode =
        body && typeof body === 'object' && 'errorCode' in body ? body.errorCode : null
      if (errorCode === 'AUTH_CONTEXT_CHANGED' || errorCode === 'SESSION_CHANGED')
        throw new ContextRequestError(401, 'AUTH_CONTEXT_CHANGED')
      const code = response.status === 401 ? 'invalid' : 'network'
      throw Object.assign(new Error(`Upstream refresh failed with status ${response.status}`), {
        code,
      })
    }

    // From here on the backend has rotated the token: a reply that cannot be read is a rotation
    // that was not published, not a request that never produced an effect.
    let data: { accessToken: string }
    try {
      const body: unknown = await response.json()
      if (!body || typeof (body as { accessToken?: unknown }).accessToken !== 'string')
        throw new TypeError('Upstream refresh reply has no access token')
      data = body as { accessToken: string }
    } catch (cause) {
      throw new UpstreamRotationUnprovenError(cause)
    }
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
}
