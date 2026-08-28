// init:project --mode=single: oauth-exchange-handler.ts. Found while
// implementing, not named in the original plan — this file hand-builds
// `/{locale}/...` redirect URLs with a plain template literal, not via
// @/i18n/navigation, so it was invisible to the "grep for @/i18n/navigation
// importers" sweep the original scope was based on. Whole-file
// exactContentStep rather than scattered replaceExactBlock calls: the
// `locale` parameter threads through both functions' signatures and every
// call site, so most of the file changes, and one before/after pair is
// clearer than several small patches that would together cover nearly the
// whole file anyway.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { mintSession } from './mint-session'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

import 'server-only'

const REFRESH_COOKIE_NAME = 'refresh_token'
const OAUTH_ERROR_QUERY_PARAM = 'oauthError'

/**
 * \`/{locale}/auth/callback\` — the browser lands here after
 * \`oauth-provider-proxy.ts\`'s callback leg relayed a successful login
 * redirect. This request now carries the frontend-host-scoped
 * \`refresh_token\` cookie the backend minted (see that module's doc), which
 * is exactly what \`POST /auth/oauth/exchange\` requires to bind the ticket
 * to the right session.
 *
 * Exchanges the ticket, fetches the user profile, mints the vault entry,
 * sets \`amcore_session\`, and — critically — clears the temporary
 * \`refresh_token\` cookie: the browser must not keep holding it once
 * consumed (ADR-068's "browser never holds a backend token in any form"
 * applies here too, just with a brief, unavoidable exception for this one
 * hop while the OAuth dance is in flight).
 */
export async function handleOAuthExchange(request: Request, locale: string): Promise<NextResponse> {
  const ticket = new URL(request.url).searchParams.get('ticket')
  const refreshToken = (await cookies()).get(REFRESH_COOKIE_NAME)?.value

  if (!ticket || !refreshToken) {
    return failureRedirect(request, locale)
  }

  let accessToken: string
  try {
    accessToken = await callUpstreamOAuthExchange(ticket, refreshToken)
  } catch (error) {
    return failureRedirect(request, locale, error)
  }

  let user
  try {
    user = await fetchCurrentUser(accessToken)
  } catch (error) {
    return failureRedirect(request, locale, error)
  }
  if (!user) {
    return failureRedirect(request, locale)
  }

  let sessionId: string
  try {
    ;({ sessionId } = await mintSession({ accessToken, refreshToken, user }))
  } catch (error) {
    return failureRedirect(request, locale, error)
  }

  const response = NextResponse.redirect(new URL(\`/\${locale}\`, request.url))
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions())
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}

function failureRedirect(request: Request, locale: string, error?: unknown): NextResponse {
  if (error) {
    const status = error instanceof UpstreamOAuthError ? error.status : undefined
    console.error('[bff] OAuth exchange failed', status ? { status } : error)
  }

  const url = new URL(\`/\${locale}/login\`, request.url)
  url.searchParams.set(OAUTH_ERROR_QUERY_PARAM, AuthErrorCode.OAUTH_TICKET_INVALID)

  const response = NextResponse.redirect(url)
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}
`

const AFTER = `import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { AuthErrorCode } from '@amcore/shared'

import { mintSession } from './mint-session'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie'
import { callUpstreamOAuthExchange, fetchCurrentUser, UpstreamOAuthError } from './upstream-oauth'

import 'server-only'

const REFRESH_COOKIE_NAME = 'refresh_token'
const OAUTH_ERROR_QUERY_PARAM = 'oauthError'

/**
 * \`/auth/callback\` — the browser lands here after
 * \`oauth-provider-proxy.ts\`'s callback leg relayed a successful login
 * redirect. This request now carries the frontend-host-scoped
 * \`refresh_token\` cookie the backend minted (see that module's doc), which
 * is exactly what \`POST /auth/oauth/exchange\` requires to bind the ticket
 * to the right session.
 *
 * Exchanges the ticket, fetches the user profile, mints the vault entry,
 * sets \`amcore_session\`, and — critically — clears the temporary
 * \`refresh_token\` cookie: the browser must not keep holding it once
 * consumed (ADR-068's "browser never holds a backend token in any form"
 * applies here too, just with a brief, unavoidable exception for this one
 * hop while the OAuth dance is in flight).
 */
export async function handleOAuthExchange(request: Request): Promise<NextResponse> {
  const ticket = new URL(request.url).searchParams.get('ticket')
  const refreshToken = (await cookies()).get(REFRESH_COOKIE_NAME)?.value

  if (!ticket || !refreshToken) {
    return failureRedirect(request)
  }

  let accessToken: string
  try {
    accessToken = await callUpstreamOAuthExchange(ticket, refreshToken)
  } catch (error) {
    return failureRedirect(request, error)
  }

  let user
  try {
    user = await fetchCurrentUser(accessToken)
  } catch (error) {
    return failureRedirect(request, error)
  }
  if (!user) {
    return failureRedirect(request)
  }

  let sessionId: string
  try {
    ;({ sessionId } = await mintSession({ accessToken, refreshToken, user }))
  } catch (error) {
    return failureRedirect(request, error)
  }

  const response = NextResponse.redirect(new URL('/', request.url))
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions())
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}

function failureRedirect(request: Request, error?: unknown): NextResponse {
  if (error) {
    const status = error instanceof UpstreamOAuthError ? error.status : undefined
    console.error('[bff] OAuth exchange failed', status ? { status } : error)
  }

  const url = new URL('/login', request.url)
  url.searchParams.set(OAUTH_ERROR_QUERY_PARAM, AuthErrorCode.OAUTH_TICKET_INVALID)

  const response = NextResponse.redirect(url)
  response.cookies.delete(REFRESH_COOKIE_NAME)
  return response
}
`

export function buildWebNavOauthSteps(root) {
  const rel = 'apps/web/src/shared/api/bff/oauth-exchange-handler.ts'
  return [
    exactContentStep(
      path.join(root, rel),
      { expectedBefore: BEFORE, after: AFTER },
      `${rel}: drop the locale parameter and unprefix the redirect URLs`
    ),
  ]
}
