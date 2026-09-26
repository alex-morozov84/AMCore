import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

function originRejected(request: Request): Response {
  return apiErrorResponse(request, {
    statusCode: 403,
    message: 'Request origin rejected',
    errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
  })
}

function relay(upstreamResponse: Response): Response {
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

/**
 * Console session-management proxying for another user's account. Fixed,
 * server-derived paths only — `userId`/`sessionId` come from this Route
 * Handler's own dynamic segments, never a client-supplied upstream path.
 * `forwardRequestHeaders` already carries the browser's own
 * `Accept-Language` through unchanged (it strips only hop-by-hop/cookie/
 * forwarded-IP headers), so the list handler needs no locale-specific code
 * of its own — unlike the self-service `sessions-handler.ts`, which builds
 * its upstream headers from scratch and has to add it back explicitly.
 */
export async function handleConsoleUserSessionsList(request: Request, userId: string) {
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  const trustedClientIp = resolveTrustedClientIp(request.headers)
  const upstream = new URL(`${API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}/sessions`)
  upstream.search = new URL(request.url).search

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstream, {
      headers: forwardRequestHeaders(request.headers, resolved.token, trustedClientIp),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Sessions temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}

export async function handleConsoleUserSessionRevoke(
  request: Request,
  userId: string,
  sessionId: string
) {
  if (!isConsoleRequestOriginTrusted(request)) return originRejected(request)

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  const trustedClientIp = resolveTrustedClientIp(request.headers)
  const upstream =
    `${API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}` +
    `/sessions/${encodeURIComponent(sessionId)}`

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstream, {
      method: 'DELETE',
      headers: forwardRequestHeaders(request.headers, resolved.token, trustedClientIp),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Session revoke temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}

export async function handleConsoleUserSessionsRevokeAll(request: Request, userId: string) {
  if (!isConsoleRequestOriginTrusted(request)) return originRejected(request)

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  const trustedClientIp = resolveTrustedClientIp(request.headers)
  const upstream = `${API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}/sessions`

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstream, {
      method: 'DELETE',
      headers: forwardRequestHeaders(request.headers, resolved.token, trustedClientIp),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Session revoke temporarily unavailable',
    })
  }
  return relay(upstreamResponse)
}
