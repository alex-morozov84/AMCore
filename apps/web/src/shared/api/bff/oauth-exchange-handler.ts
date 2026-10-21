import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { productAdminReturnPath } from '@amcore/shared'
import {
  AuthErrorCode,
  coerceSupportedLocale,
  localizedFrontendUrl,
  type OAuthExchangeResponse,
} from '@amcore/shared'

import { revokeBackendSession } from './backend-session-revocation'
import { assertOrdinaryOAuthAllowed, retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { publishInvitedOAuth } from './invitation-oauth-exchange'
import { recoverPublishedInvitedOAuth } from './invitation-oauth-recovery'
import { invitationCanonicalOrigin } from './invitation-render-request'
import { invitationPagePath } from './invitation-surface'
import { mintSession } from './mint-session'
import type { OAuthCompletionInput } from './oauth-completion-input'
import type { ProductWebContext } from './product-web-context.server'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { redisVaultStore } from './session-vault-store'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

import 'server-only'

const REFRESH_COOKIE_NAME = 'refresh_token'
const OAUTH_ERROR_QUERY_PARAM = 'oauthError'

/** Server-only exchange after exact-Origin admission and bounded native form parsing.
 * The GET completion document does not call this operation or access credentials.
 * Invitation publication/recovery keeps the established atomic protocol.
 */
export async function handleOAuthExchange(
  request: Request,
  { ticket, locale }: OAuthCompletionInput,
  context: ProductWebContext
): Promise<NextResponse> {
  const refreshCookie =
    context?.frontend === 'admin' ? '__Host-amcore_admin_oauth_refresh' : REFRESH_COOKIE_NAME
  if (ticket) {
    const recovered = await recoverPublishedInvitedOAuth(request, ticket, context).catch(() => null)
    if (recovered) {
      const response = NextResponse.redirect(
        localizedFrontendUrl(
          context?.origin ?? invitationCanonicalOrigin(request.headers, request.url),
          coerceSupportedLocale(recovered.locale),
          invitationPagePath(`invite/flow/${recovered.flowId}`, context)
        ),
        303
      )
      clearTransientCookie(response, context)
      response.headers.set('cache-control', 'private, no-store')
      response.headers.set('referrer-policy', 'no-referrer')
      response.headers.set('x-robots-tag', 'noindex, nofollow')
      return response
    }
  }
  const refreshToken = (await cookies()).get(refreshCookie)?.value

  if (!ticket || !refreshToken) {
    return failureRedirect(request, locale, undefined, context)
  }

  let exchange: OAuthExchangeResponse
  try {
    exchange = await callUpstreamOAuthExchange(
      ticket,
      refreshToken,
      request.headers,
      undefined,
      context
    )
  } catch (error) {
    return failureRedirect(request, locale, error, context)
  }

  let user
  try {
    user = await fetchCurrentUser(exchange.accessToken, request.headers, undefined, context)
  } catch (error) {
    if (!exchange.invitation) await revokeBackendSession(refreshToken)
    return failureRedirect(request, locale, error, context)
  }
  if (!user) {
    if (!exchange.invitation) await revokeBackendSession(refreshToken)
    return failureRedirect(request, locale, undefined, context)
  }

  if (exchange.invitation) {
    try {
      const published = await publishInvitedOAuth(
        request,
        ticket,
        exchange,
        refreshToken,
        user,
        context
      )
      const response = NextResponse.redirect(
        localizedFrontendUrl(
          context?.origin ?? invitationCanonicalOrigin(request.headers, request.url),
          coerceSupportedLocale(published.locale),
          invitationPagePath(`invite/flow/${published.flowId}`, context)
        ),
        303
      )
      response.cookies.set(
        context?.cookieName ?? SESSION_COOKIE_NAME,
        published.sessionId,
        context?.cookieOptions ?? sessionCookieOptions()
      )
      clearTransientCookie(response, context)
      response.headers.set('cache-control', 'private, no-store')
      response.headers.set('referrer-policy', 'no-referrer')
      response.headers.set('x-robots-tag', 'noindex, nofollow')
      return response
    } catch (error) {
      return failureRedirect(request, locale, error, context)
    }
  }

  let sessionId: string
  try {
    await assertOrdinaryOAuthAllowed(request, context)
    ;({ sessionId } = await mintSession(
      { accessToken: exchange.accessToken, refreshToken, user },
      context?.store
    ))
    try {
      await retireFlowsForOrdinaryAuth(
        request,
        { sessionId, actorId: user.id },
        { rejectPendingHandoff: true },
        context
      )
    } catch (error) {
      await (context?.store ?? redisVaultStore).delete(sessionId).catch(() => undefined)
      throw error
    }
  } catch (error) {
    await revokeBackendSession(refreshToken)
    return failureRedirect(request, locale, error, context)
  }

  const target = context
    ? localizedFrontendUrl(
        context.origin,
        exchange.returnTo?.locale ?? coerceSupportedLocale(locale),
        exchange.returnTo ? productAdminReturnPath(exchange.returnTo) : context.entryPath
      )
    : new URL(`/${locale}`, request.url)
  const response = NextResponse.redirect(target, 303)
  response.cookies.set(
    context?.cookieName ?? SESSION_COOKIE_NAME,
    sessionId,
    context?.cookieOptions ?? sessionCookieOptions()
  )
  clearTransientCookie(response, context)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}

function failureRedirect(
  request: Request,
  locale: string,
  error?: unknown,
  context?: ProductWebContext
): NextResponse {
  if (error) {
    const status = error instanceof UpstreamOAuthError ? error.status : undefined
    console.error('[bff] OAuth exchange failed', { status: status ?? 503 })
  }

  const url = context
    ? new URL(
        localizedFrontendUrl(context.origin, coerceSupportedLocale(locale), context.loginPath)
      )
    : new URL(`/${locale}/login`, request.url)
  url.searchParams.set(OAUTH_ERROR_QUERY_PARAM, AuthErrorCode.OAUTH_TICKET_INVALID)

  const response = NextResponse.redirect(url, 303)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  clearTransientCookie(response, context)
  return response
}

function clearTransientCookie(response: NextResponse, context?: ProductWebContext) {
  if (context?.frontend === 'admin')
    response.cookies.set('__Host-amcore_admin_oauth_refresh', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    })
  else
    response.cookies.set(REFRESH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    })
}
