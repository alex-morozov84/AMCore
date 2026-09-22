import { NextResponse } from 'next/server'
import { AuthErrorCode, stepUpSchema } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders } from '@/shared/api/bff/proxy-headers'
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

/**
 * Console step-up (ADR-037 fresh-auth). Deliberately does not stream the
 * upstream response back verbatim the way an ordinary mutation proxy would:
 * `POST /auth/step-up`'s success body is a real `{ accessToken, refreshToken }`
 * pair. This handler reads that body server-side, discards it entirely (the
 * operator's existing session remains valid for the immediate retry —
 * freshness is server-side, not carried by the token), and always responds
 * without a body on success. Error bodies (400/401/403/429) carry no
 * credential and are relayed as-is.
 */
export async function handleConsoleStepUp(request: Request): Promise<Response> {
  if (!isConsoleRequestOriginTrusted(request)) return originRejected(request)

  const parsed = stepUpSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  }

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure

  const trustedClientIp = resolveTrustedClientIp(request.headers)

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${API_URL}/api/v1/auth/step-up`, {
      method: 'POST',
      headers: forwardRequestHeaders(request.headers, resolved.token, trustedClientIp),
      body: JSON.stringify(parsed.data),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Step-up temporarily unavailable',
    })
  }

  if (!upstreamResponse.ok) {
    const errorBody: unknown = await upstreamResponse.json().catch(() => null)
    return NextResponse.json(
      errorBody ?? { statusCode: upstreamResponse.status, message: 'Step-up failed' },
      { status: upstreamResponse.status }
    )
  }

  // Discard the token-bearing success body — never forwarded to the browser.
  await upstreamResponse.json().catch(() => null)
  return new Response(null, { status: 204 })
}
