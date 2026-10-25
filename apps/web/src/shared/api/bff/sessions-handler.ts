import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'
import {
  frontendApiHeaders,
  isProductMutationTrusted,
  type ProductWebContext,
} from './product-web-context.server'
import { forwardResponseHeaders } from './proxy-headers'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import type { VaultEntry } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'
import { createUpstreamRefresh } from './upstream-refresh'

import 'server-only'

const API_URL = getBackendBaseUrl()
const REFRESH_COOKIE_NAME = 'refresh_token'

/**
 * Dedicated handlers for `/auth/sessions*` (ADR-068, sessions-list slice) —
 * not the generic `authenticated-proxy.ts`, which deliberately never
 * forwards the browser's own cookies. The backend identifies the
 * "current" session by hashing the raw `refresh_token` cookie on its own
 * incoming request (`auth.controller.ts`), so every call here needs
 * **both** `Authorization: Bearer` and a `Cookie: refresh_token=...`
 * header built from the vault entry — the same shape `logout-handler.ts`
 * already established for this exact reason.
 */
async function getVaultEntryOrFailure(
  request: Request,
  context?: ProductWebContext
): Promise<VaultEntry | Response> {
  const sessionId = (await cookies()).get(context?.cookieName ?? SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }

  try {
    return await ensureFreshSession(sessionId, {
      store: context?.store ?? redisVaultStore,
      expectedAudience: context?.audience,
      lock: context?.lock ?? redisVaultLock,
      upstreamRefresh: createUpstreamRefresh(request.headers, context),
    })
  } catch (error) {
    return authFailureResponse(request, error)
  }
}

/**
 * `acceptLanguage` carries the viewer's active UI locale (used only for the
 * approximate-location city name on `GET /auth/sessions` — display locale,
 * never authorization); omitted entirely for the DELETE handlers, which
 * have no locale-dependent response.
 */
function authHeaders(entry: VaultEntry, acceptLanguage?: string | null): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${entry.accessToken}`,
    Cookie: `${REFRESH_COOKIE_NAME}=${entry.refreshToken}`,
  })
  if (acceptLanguage) headers.set('Accept-Language', acceptLanguage)
  return headers
}

function relay(upstreamResponse: Response): Response {
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

/** `GET /api/auth/sessions?page&limit` — safe method, no CSRF gate needed. */
export async function handleGetSessions(
  request: Request,
  context?: ProductWebContext
): Promise<Response> {
  const entry = await getVaultEntryOrFailure(request, context)
  if (entry instanceof Response) return entry

  const upstream = new URL(`${API_URL}/api/v1/auth/sessions`)
  upstream.search = new URL(request.url).search

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchBackendResponse(upstream, request.headers, {
      headers: context
        ? frontendApiHeaders(context, authHeaders(entry, request.headers.get('accept-language')))
        : authHeaders(entry, request.headers.get('accept-language')),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Backend temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}

/** `DELETE /api/auth/sessions/:sessionId` — state-changing, CSRF-gated. */
export async function handleDeleteSession(
  request: Request,
  sessionId: string,
  context?: ProductWebContext
): Promise<Response> {
  if (
    !(context?.audience === 'staff'
      ? isProductMutationTrusted(request, context)
      : isTrustedOrigin(request))
  ) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const entry = await getVaultEntryOrFailure(request, context)
  if (entry instanceof Response) return entry

  const upstream = `${API_URL}/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`
  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchBackendResponse(upstream, request.headers, {
      method: 'DELETE',
      headers: context ? frontendApiHeaders(context, authHeaders(entry)) : authHeaders(entry),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Backend temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}

/** `DELETE /api/auth/sessions` (revoke all except current) — CSRF-gated. */
export async function handleDeleteOtherSessions(
  request: Request,
  context?: ProductWebContext
): Promise<Response> {
  if (
    !(context?.audience === 'staff'
      ? isProductMutationTrusted(request, context)
      : isTrustedOrigin(request))
  ) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const entry = await getVaultEntryOrFailure(request, context)
  if (entry instanceof Response) return entry

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchBackendResponse(
      `${API_URL}/api/v1/auth/sessions`,
      request.headers,
      {
        method: 'DELETE',
        headers: context ? frontendApiHeaders(context, authHeaders(entry)) : authHeaders(entry),
      }
    )
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Backend temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}
