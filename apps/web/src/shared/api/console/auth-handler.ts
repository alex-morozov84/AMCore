import { NextResponse } from 'next/server'
import { AuthErrorCode, loginSchema, type UserResponse } from '@amcore/shared'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { revokeBackendSession } from '@/shared/api/bff/backend-session-revocation'
import { callUpstreamAuth, UpstreamAuthError } from '@/shared/api/bff/upstream-auth'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { probeConsoleAccessWithToken } from './access-probe'
import { isTrustedConsoleOrigin } from './origin-guard'
import { mintConsoleSession } from './session'
import { CONSOLE_SESSION_COOKIE_NAME, consoleSessionCookieOptions } from './session-cookie'

import 'server-only'

export async function handleConsoleLogin(request: Request): Promise<Response> {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') return new Response(null, { status: 404 })
  if (!isTrustedConsoleOrigin(request)) return originRejected(request)

  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return validationRejected(request, parsed.error)

  let upstream
  try {
    upstream = await callUpstreamAuth<UserResponse>('/auth/login', parsed.data, request)
  } catch (error) {
    if (error instanceof UpstreamAuthError) {
      return NextResponse.json(error.body as object, { status: error.status })
    }
    return unavailable(request)
  }

  const access = await probeConsoleAccessWithToken(upstream.accessToken)
  if (access.kind !== 'admitted') {
    await revokeBackendSession(upstream.refreshToken)
    return access.kind === 'denied' ? accessDenied(request) : unavailable(request)
  }

  try {
    const sessionId = await mintConsoleSession(upstream)
    const response = new NextResponse(null, { status: 204 })
    response.cookies.set(CONSOLE_SESSION_COOKIE_NAME, sessionId, consoleSessionCookieOptions())
    return response
  } catch {
    await revokeBackendSession(upstream.refreshToken)
    return unavailable(request)
  }
}

function originRejected(request: Request): NextResponse {
  return apiErrorResponse(request, {
    statusCode: 403,
    message: 'Request origin rejected',
    errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
  })
}

function validationRejected(
  request: Request,
  error: Parameters<typeof zodValidationErrors>[0]
): NextResponse {
  return apiErrorResponse(request, {
    statusCode: 400,
    message: 'Validation failed',
    errors: zodValidationErrors(error),
  })
}

function accessDenied(request: Request): NextResponse {
  return apiErrorResponse(request, { statusCode: 403, message: 'Console access denied' })
}

function unavailable(request: Request): NextResponse {
  return apiErrorResponse(request, { statusCode: 503, message: 'Console login unavailable' })
}
