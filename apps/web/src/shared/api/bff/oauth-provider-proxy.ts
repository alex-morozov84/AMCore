import { ContextRequestError } from './context-errors'
import { getOptionalSessionEntry } from './dal'
import { cancelInvitedOAuthForOrdinaryStart } from './invitation-auth-lifecycle'
import { startInvitedOAuth } from './invitation-oauth-start'
import { isFormPostProvider, relayOAuthCookies } from './oauth-cookie-relay'
import { oauthLoginFailure } from './oauth-login-failure'
import type { ProductWebContext } from './product-web-context.server'
import { isProductMutationTrusted } from './product-web-context.server'
import { sessionMetadataHeaders } from './session-metadata-headers'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/**
 * OAuth init/callback proxy (ADR-068). Unlike `authenticated-proxy.ts`, this is
 * deliberately unauthenticated and forwards the browser's own cookies
 * upstream rather than stripping them: the backend's callback handler reads
 * its `oauth_state`/`oauth_state_apple` binding-nonce cookie
 * (`readOAuthBindingNonce`) directly off this request. The point of routing
 * these two legs through the frontend's own origin at all is so the
 * backend's `Set-Cookie` responses (the binding nonce on init, the
 * `refresh_token` it mints on a successful login callback) land scoped to
 * the frontend's host instead of `apps/api`'s — see the module doc on
 * `oauth-cookie-relay.ts` for why that's required for Apple, and
 * `oauth-exchange-handler.ts` for why the frontend needs that
 * `refresh_token` cookie at all.
 *
 * `redirect: 'manual'` is required: the default `follow` would swallow the
 * intermediate 302's `Location` and `Set-Cookie` before this code ever saw
 * them.
 */
async function fetchUpstream(
  request: Request,
  upstreamPath: string,
  proof?: Headers,
  signal?: AbortSignal,
  context?: ProductWebContext
): Promise<Response> {
  const upstream = new URL(`${API_URL}/api/v1${upstreamPath}`)
  upstream.search = new URL(request.url).search
  upstream.searchParams.delete('invitationAttempt')

  const hasBody = request.method === 'POST' && request.body !== null
  const headers = new Headers({
    ...sessionMetadataHeaders(request.headers),
    ...context?.apiHeaders,
  })
  const nonceName = upstreamPath.endsWith('/callback')
    ? upstreamPath.includes('/apple/')
      ? context?.frontend === 'admin'
        ? 'amcore_admin_oauth_state_apple'
        : 'oauth_state_apple'
      : context?.frontend === 'admin'
        ? 'amcore_admin_oauth_state'
        : 'oauth_state'
    : null
  const cookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => nonceName && value.startsWith(`${nonceName}=`))
  if (cookies.length === 1) headers.set('cookie', cookies[0]!)
  proof?.forEach((value, name) => headers.set(name, value))
  const acceptLanguage = request.headers.get('accept-language')
  if (acceptLanguage) headers.set('accept-language', acceptLanguage)
  const contentType = request.headers.get('content-type')
  if (hasBody && contentType) headers.set('content-type', contentType)

  return fetch(upstream, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    cache: 'no-store',
    signal: signal ?? AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    ...(hasBody ? { duplex: 'half' } : {}),
  })
}

function relayResponse(
  upstream: Response,
  provider: string,
  context?: ProductWebContext
): Response {
  const headers = new Headers()
  headers.set('cache-control', 'private, no-store')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-robots-tag', 'noindex, nofollow')
  const location = upstream.headers.get('location')
  if (location) headers.set('location', location)
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  relayOAuthCookies(upstream, provider, headers, context)

  return new Response(upstream.body, { status: upstream.status, headers })
}

/** `GET /api/auth/oauth/:provider` -> backend `GET /auth/oauth/:provider`. */
async function authorize(
  request: Request,
  provider: string,
  context?: ProductWebContext
): Promise<Response> {
  const query = new URL(request.url).searchParams
  if (query.has('invitationAttempt')) {
    if (query.size !== 1) return new Response(null, { status: 400 })
    try {
      const upstream = await startInvitedOAuth(
        request,
        provider,
        query.get('invitationAttempt')!,
        (proof, signal) =>
          fetchUpstream(
            request,
            `/auth/oauth/${encodeURIComponent(provider)}`,
            proof,
            signal,
            context
          ),
        context
      )
      return relayResponse(upstream, provider, context)
    } catch (error) {
      return new Response(null, {
        status: error instanceof ContextRequestError ? error.status : 503,
        headers: {
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
          'x-robots-tag': 'noindex, nofollow',
        },
      })
    }
  }
  await cancelInvitedOAuthForOrdinaryStart(request, context)
  const upstream = await fetchUpstream(
    request,
    `/auth/oauth/${encodeURIComponent(provider)}`,
    undefined,
    undefined,
    context
  )
  return relayResponse(upstream, provider, context)
}

/** Document navigation failures return to the human-facing login form. */
export async function proxyOAuthAuthorize(
  request: Request,
  provider: string,
  context?: ProductWebContext
): Promise<Response> {
  if (
    context?.frontend === 'admin' &&
    ((request.headers.has('sec-fetch-dest') &&
      request.headers.get('sec-fetch-dest') !== 'document') ||
      /prefetch/i.test(request.headers.get('purpose') ?? request.headers.get('sec-purpose') ?? ''))
  )
    return new Response(null, { status: 400 })
  try {
    const response = await authorize(request, provider, context)
    if (context?.frontend === 'admin' && ![302, 303].includes(response.status))
      return oauthLoginFailure(request, provider, context, response)
    return response
  } catch (error) {
    if (context?.frontend === 'admin') return oauthLoginFailure(request, provider, context)
    throw error
  }
}

/**
 * `GET|POST /api/auth/oauth/:provider/callback` -> backend
 * `GET|POST /auth/oauth/:provider/callback`. POST only applies to Apple's
 * `response_mode=form_post`; the raw `application/x-www-form-urlencoded`
 * body is forwarded unparsed.
 */
export async function proxyOAuthCallback(
  request: Request,
  provider: string,
  context?: ProductWebContext
): Promise<Response> {
  if (isFormPostProvider(provider) ? request.method !== 'POST' : request.method !== 'GET') {
    return new Response(null, { status: 405 })
  }
  try {
    const upstream = await fetchUpstream(
      request,
      `/auth/oauth/${encodeURIComponent(provider)}/callback`,
      undefined,
      undefined,
      context
    )
    if (context?.frontend === 'admin' && ![302, 303].includes(upstream.status))
      return oauthLoginFailure(request, provider, context, upstream)
    return relayResponse(upstream, provider, context)
  } catch (error) {
    if (context?.frontend === 'admin') return oauthLoginFailure(request, provider, context)
    throw error
  }
}

/** Link is an authenticated mutation despite the provider's GET redirect protocol. */
export async function proxyOAuthLink(
  request: Request,
  provider: string,
  context: ProductWebContext
): Promise<Response> {
  if (!isProductMutationTrusted(request, context))
    throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
  if (!['google', 'github', 'apple', 'telegram'].includes(provider))
    throw new ContextRequestError(404, 'NOT_FOUND')
  const entry = await getOptionalSessionEntry('admin-auth')
  if (!entry) throw new ContextRequestError(401, 'UNAUTHORIZED')
  const upstream = await fetchUpstream(
    request,
    `/auth/oauth/${provider}/link`,
    new Headers({ authorization: `Bearer ${entry.accessToken}` }),
    undefined,
    context
  )
  if (![302, 303].includes(upstream.status))
    return oauthLoginFailure(request, provider, context, upstream)
  return relayResponse(upstream, provider, context)
}
