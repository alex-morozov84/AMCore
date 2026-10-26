import { NextResponse } from 'next/server'
import { AuthErrorCode, type UserResponse } from '@amcore/shared'
import type { ZodType } from 'zod'

import { apiErrorResponse, zodValidationErrors } from './api-error-response'
import { revokeBackendSession } from './backend-session-revocation'
import { SessionVaultUnavailableError } from './errors'
import { retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { mintSession } from './mint-session'
import { isTrustedOrigin } from './origin-guard'
import { isProductMutationTrusted, type ProductWebContext } from './product-web-context.server'
import { registrationSignInRequiredResponse } from './registration-outcome'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { redisVaultStore } from './session-vault-store'
import {
  callUpstreamAuth,
  callUpstreamRegister,
  UpstreamAuthError,
  type UpstreamAuthResult,
} from './upstream-auth'

import 'server-only'

export interface CredentialAuthOptions<TInput> {
  context?: ProductWebContext
  schema: ZodType<TInput>
  backendPath: string
  successStatus: number
  /**
   * Set only by the register route. Enables the confirmed-creation classification:
   * a failure to publish the browser session after the API confirmed creation returns
   * `REGISTRATION_SIGN_IN_REQUIRED` instead of a generic failure. Login stays unchanged.
   */
  registration?: true
}

/**
 * Calls the register endpoint and keeps only a confirmed creation. An unconfirmed success
 * keeps the generic failure (any session cookie is revoked once). `null` means the account
 * exists but the API set no session cookie, so there is nothing to publish or revoke.
 */
async function callRegistration<TInput>(
  request: Request,
  options: CredentialAuthOptions<TInput>,
  body: unknown
): Promise<UpstreamAuthResult<UserResponse> | null> {
  const registered = await callUpstreamRegister(options.backendPath, body, request, options.context)
  if (registered.outcome === 'unknown') {
    if (registered.refreshToken)
      await revokeBackendSession(registered.refreshToken, request.headers)
    throw new Error('Upstream registration did not confirm creation')
  }
  if (!registered.refreshToken) {
    console.error('[bff] registration confirmed without a session cookie')
    return null
  }
  return {
    user: registered.user,
    accessToken: registered.accessToken,
    refreshToken: registered.refreshToken,
  }
}

/** Register: the account exists, so report that. Login (and anything else): rethrow as before. */
function publicationFailure<TInput>(
  request: Request,
  options: CredentialAuthOptions<TInput>,
  error: unknown
): NextResponse {
  if (!options.registration) throw error
  console.error('[bff] registration session publication failed', {
    category: error instanceof SessionVaultUnavailableError ? 'vault' : 'unexpected',
  })
  return registrationSignInRequiredResponse(request)
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

  let upstream: UpstreamAuthResult<UserResponse> | null
  try {
    upstream = options.registration
      ? await callRegistration(request, options, parsed.data)
      : await callUpstreamAuth<UserResponse>(options.backendPath, parsed.data, request, context)
  } catch (error) {
    if (error instanceof UpstreamAuthError) {
      return NextResponse.json(error.body as object, { status: error.status })
    }
    if (error instanceof TypeError)
      return apiErrorResponse(request, {
        statusCode: 503,
        message: 'Backend temporarily unavailable',
      })
    throw error
  }

  // Created, but there is no session this layer could revoke or publish.
  if (!upstream) return registrationSignInRequiredResponse(request)

  let minted
  try {
    minted = context ? await mintSession(upstream, context.store) : await mintSession(upstream)
  } catch (error) {
    await revokeBackendSession(upstream.refreshToken, request.headers)
    return publicationFailure(request, options, error)
  }
  const { sessionId, user } = minted
  try {
    await retireFlowsForOrdinaryAuth(request, { sessionId, actorId: user.id }, undefined, context)
  } catch (error) {
    await (context?.store ?? redisVaultStore).delete(sessionId).catch(() => undefined)
    await revokeBackendSession(upstream.refreshToken, request.headers)
    return publicationFailure(request, options, error)
  }

  const response = NextResponse.json({ user }, { status: options.successStatus })
  response.cookies.set(
    context?.cookieName ?? SESSION_COOKIE_NAME,
    sessionId,
    context?.cookieOptions ?? sessionCookieOptions()
  )
  return response
}
