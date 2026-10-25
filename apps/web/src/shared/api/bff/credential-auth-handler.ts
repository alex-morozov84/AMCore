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

  let upstream: UpstreamAuthResult<UserResponse>
  try {
    if (options.registration) {
      const registered = await callUpstreamRegister(
        options.backendPath,
        parsed.data,
        request,
        context
      )
      if (registered.outcome === 'unknown') {
        // Not evidence of creation: keep the generic failure, but revoke any session cookie once.
        if (registered.refreshToken)
          await revokeBackendSession(registered.refreshToken, request.headers)
        throw new Error('Upstream registration did not confirm creation')
      }
      if (!registered.refreshToken) {
        // Created, but there is no session this layer could revoke or publish.
        console.error('[bff] registration confirmed without a session cookie')
        return registrationSignInRequiredResponse(request)
      }
      upstream = {
        user: registered.user,
        accessToken: registered.accessToken,
        refreshToken: registered.refreshToken,
      }
    } else {
      upstream = await callUpstreamAuth<UserResponse>(
        options.backendPath,
        parsed.data,
        request,
        context
      )
    }
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
