import { NextResponse } from 'next/server'
import { AuthErrorCode, type UserResponse } from '@amcore/shared'
import type { ZodType } from 'zod'

import { apiErrorResponse, zodValidationErrors } from './api-error-response'
import { mintSession } from './mint-session'
import { isTrustedOrigin } from './origin-guard'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { callUpstreamAuth, UpstreamAuthError } from './upstream-auth'

import 'server-only'

export interface CredentialAuthOptions<TInput> {
  schema: ZodType<TInput>
  backendPath: string
  successStatus: number
}

/**
 * Shared implementation behind `/api/auth/login` and `/api/auth/register`:
 * CSRF-check the request, validate the body, call the backend server-side,
 * mint a vault entry from the result, and set the one cookie the browser
 * ever gets (ADR-068). `route.ts` files stay thin adapters over this.
 */
export async function handleCredentialAuth<TInput>(
  request: Request,
  options: CredentialAuthOptions<TInput>
): Promise<NextResponse> {
  if (!isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = options.schema.safeParse(rawBody)
  if (!parsed.success) {
    return apiErrorResponse(request, {
      statusCode: 400,
      message: 'Validation failed',
      errors: zodValidationErrors(parsed.error),
    })
  }

  let upstream
  try {
    upstream = await callUpstreamAuth<UserResponse>(options.backendPath, parsed.data, request)
  } catch (error) {
    if (error instanceof UpstreamAuthError) {
      return NextResponse.json(error.body as object, { status: error.status })
    }
    throw error
  }

  const { sessionId, user } = await mintSession(upstream)

  const response = NextResponse.json({ user }, { status: options.successStatus })
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions())
  return response
}
