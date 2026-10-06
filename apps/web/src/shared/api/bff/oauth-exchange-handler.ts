import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  AuthErrorCode,
  coerceSupportedLocale,
  localizedFrontendUrl,
  type OAuthExchangeResponse,
} from '@amcore/shared'

import { assertOrdinaryOAuthAllowed, retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { publishInvitedOAuth } from './invitation-oauth-exchange'
import { recoverPublishedInvitedOAuth } from './invitation-oauth-recovery'
import { invitationCanonicalOrigin } from './invitation-render-request'
import { mintSession } from './mint-session'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { redisVaultStore } from './session-vault-store'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

import 'server-only'

const REFRESH_COOKIE_NAME = 'refresh_token'
const OAUTH_ERROR_QUERY_PARAM = 'oauthError'

/**
 * `/{locale}/auth/callback` — the browser lands here after
 * `oauth-provider-proxy.ts`'s callback leg relayed a successful login
 * redirect. This request now carries the frontend-host-scoped
 * `refresh_token` cookie the backend minted (see that module's doc), which
 * is exactly what `POST /auth/oauth/exchange` requires to bind the ticket
 * to the right session.
 *
 * Exchanges the ticket, fetches the user profile, mints the vault entry,
 * sets `amcore_session`, and — critically — clears the temporary
 * `refresh_token` cookie: the browser must not keep holding it once
 * consumed (ADR-068's "browser never holds a backend token in any form"
 * applies here too, just with a brief, unavoidable exception for this one
 * hop while the OAuth dance is in flight).
 */
export async function handleOAuthExchange(request: Request, locale: string): Promise<NextResponse> {
  const query = new URL(request.url).searchParams
  const ticket =
    query.getAll('ticket').length === 1 && query.size === 1 ? query.get('ticket') : null
  if (ticket && ticket.length > 4096) return failureRedirect(request, locale)
  if (ticket) {
    const recovered = await recoverPublishedInvitedOAuth(request, ticket).catch(() => null)
    if (recovered) {
      const response = NextResponse.redirect(
        localizedFrontendUrl(
          invitationCanonicalOrigin(request.headers, request.url),
          coerceSupportedLocale(recovered.locale),
          `invite/flow/${recovered.flowId}`
        ),
        303
      )
      response.cookies.delete(REFRESH_COOKIE_NAME)
      response.headers.set('cache-control', 'private, no-store')
      response.headers.set('referrer-policy', 'no-referrer')
      response.headers.set('x-robots-tag', 'noindex, nofollow')
      return response
    }
  }
  const refreshToken = (await cookies()).get(REFRESH_COOKIE_NAME)?.value

  if (!ticket || !refreshToken) {
    return failureRedirect(request, locale)
  }

  let exchange: OAuthExchangeResponse
  try {
    exchange = await callUpstreamOAuthExchange(ticket, refreshToken, request.headers)
  } catch (error) {
    return failureRedirect(request, locale, error)
  }

  let user
  try {
    user = await fetchCurrentUser(exchange.accessToken, request.headers)
  } catch (error) {
    return failureRedirect(request, locale, error)
  }
  if (!user) {
    return failureRedirect(request, locale)
  }

  if (exchange.invitation) {
    try {
      const published = await publishInvitedOAuth(request, ticket, exchange, refreshToken, user)
      const response = NextResponse.redirect(
        localizedFrontendUrl(
          invitationCanonicalOrigin(request.headers, request.url),
          coerceSupportedLocale(published.locale),
          `invite/flow/${published.flowId}`
        ),
        303
      )
      response.cookies.set(SESSION_COOKIE_NAME, published.sessionId, sessionCookieOptions())
      response.cookies.delete(REFRESH_COOKIE_NAME)
      response.headers.set('cache-control', 'private, no-store')
      response.headers.set('referrer-policy', 'no-referrer')
      response.headers.set('x-robots-tag', 'noindex, nofollow')
      return response
    } catch (error) {
      return failureRedirect(request, locale, error)
    }
  }

  let sessionId: string
  try {
    await assertOrdinaryOAuthAllowed(request)
    ;({ sessionId } = await mintSession({ accessToken: exchange.accessToken, refreshToken, user }))
    try {
      await retireFlowsForOrdinaryAuth(
        request,
        { sessionId, actorId: user.id },
        { rejectPendingHandoff: true }
      )
    } catch (error) {
      await redisVaultStore.delete(sessionId).catch(() => undefined)
      throw error
    }
  } catch (error) {
    return failureRedirect(request, locale, error)
  }

  const response = NextResponse.redirect(new URL(`/${locale}`, request.url))
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions())
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}

function failureRedirect(request: Request, locale: string, error?: unknown): NextResponse {
  if (error) {
    const status = error instanceof UpstreamOAuthError ? error.status : undefined
    console.error('[bff] OAuth exchange failed', { status: status ?? 503 })
  }

  const url = new URL(`/${locale}/login`, request.url)
  url.searchParams.set(OAUTH_ERROR_QUERY_PARAM, AuthErrorCode.OAUTH_TICKET_INVALID)

  const response = NextResponse.redirect(url)
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}
