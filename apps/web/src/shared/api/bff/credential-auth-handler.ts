import { NextResponse } from 'next/server'
import { AuthErrorCode, type UserResponse } from '@amcore/shared'
import type { ZodType } from 'zod'

import { apiErrorResponse, zodValidationErrors } from './api-error-response'
import { revokeBackendSession } from './backend-session-revocation'
import { retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { mintSession } from './mint-session'
import { isTrustedOrigin } from './origin-guard'
import { isProductMutationTrusted, type ProductWebContext } from './product-web-context.server'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { redisVaultStore } from './session-vault-store'
import { callUpstreamAuth, UpstreamAuthError } from './upstream-auth'

import 'server-only'

export interface CredentialAuthOptions<TInput> {
  context?: ProductWebContext
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
  const context = options.context
  if (
    !(context?.frontend === 'admin'
      ? isProductMutationTrusted(request, context)
      : isTrustedOrigin(request))
  ) {
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
    upstream = await callUpstreamAuth<UserResponse>(
      options.backendPath,
      parsed.data,
      request,
      context
    )
  } catch (error) {
    if (error instanceof UpstreamAuthError) {
      return NextResponse.json(error.body as object, { status: error.status })
    }
    throw error
  }

  let minted
  try {
    minted = context ? await mintSession(upstream, context.store) : await mintSession(upstream)
  } catch (error) {
    await revokeBackendSession(upstream.refreshToken)
    throw error
  }
  const { sessionId, user } = minted
  try {
    await retireFlowsForOrdinaryAuth(request, { sessionId, actorId: user.id }, undefined, context)
  } catch (error) {
    await (context?.store ?? redisVaultStore).delete(sessionId).catch(() => undefined)
    await revokeBackendSession(upstream.refreshToken)
    throw error
  }

  const response = NextResponse.json({ user }, { status: options.successStatus })
  response.cookies.set(
    context?.cookieName ?? SESSION_COOKIE_NAME,
    sessionId,
    context?.cookieOptions ?? sessionCookieOptions()
  )
  return response
}
