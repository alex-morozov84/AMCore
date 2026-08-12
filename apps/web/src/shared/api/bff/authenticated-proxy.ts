import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { ensureFreshSession } from './ensure-fresh-session'
import { isInvalidRefreshError, SessionNotFoundError, SessionRefreshUnsafeError } from './errors'
import { isTrustedOrigin } from './origin-guard'
import { forwardRequestHeaders, forwardResponseHeaders } from './proxy-headers'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { redisVaultStore } from './session-vault-store'
import { upstreamRefresh } from './upstream-refresh'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The generic authenticated Route Handler proxy (ADR-068): reads
 * `amcore_session`, ensures a fresh access token via the single-flight
 * protocol, and forwards the request to `apps/api` with both request and
 * response bodies streamed (not buffered) so multipart uploads and SSE
 * responses pass through unmodified.
 */
export async function proxyToBackend(request: Request, pathSegments: string[]): Promise<Response> {
  if (!SAFE_METHODS.has(request.method) && !isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }

  let accessToken: string
  try {
    const session = await ensureFreshSession(sessionId, {
      store: redisVaultStore,
      lock: redisVaultLock,
      upstreamRefresh,
    })
    accessToken = session.accessToken
  } catch (error) {
    return authFailureResponse(request, error)
  }

  const upstreamUrl = buildUpstreamUrl(pathSegments, request)
  const hasBody = !SAFE_METHODS.has(request.method) && request.body !== null

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: forwardRequestHeaders(request.headers, accessToken),
    body: hasBody ? request.body : undefined,
    // Required by Node's fetch (undici) whenever `body` is a stream.
    ...(hasBody ? { duplex: 'half' } : {}),
  })

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

function buildUpstreamUrl(pathSegments: string[], request: Request): string {
  const upstream = new URL(`${API_URL}/api/v1/${pathSegments.map(encodeURIComponent).join('/')}`)
  upstream.search = new URL(request.url).search
  return upstream.toString()
}

/**
 * Only an explicit "this credential is dead" signal (`SessionNotFoundError`,
 * `SessionRefreshUnsafeError`, or `isInvalidRefreshError` — backend
 * `401 TOKEN_INVALID`) maps to 401. Everything else — Redis/lock trouble,
 * or a transient `upstreamRefresh` failure (`code: 'network'`, an uncoded
 * fetch exception, a backend 5xx) — fails closed as 503 rather than either
 * logging the user out or crashing into an unhandled 500 (round 2 finding:
 * the previous version mapped *any* `Error` with a `code` property to 401,
 * which included transient network failures).
 */
function authFailureResponse(request: Request, error: unknown): Response {
  if (error instanceof SessionNotFoundError || error instanceof SessionRefreshUnsafeError) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }
  if (isInvalidRefreshError(error)) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }
  // SessionVaultUnavailableError, SessionLockTimeoutError, or a transient
  // upstreamRefresh failure — cannot prove auth right now, not "logged out."
  return apiErrorResponse(request, {
    statusCode: 503,
    message: 'Authentication temporarily unavailable',
  })
}
