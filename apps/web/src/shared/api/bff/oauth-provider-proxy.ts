import { isFormPostProvider, relayOAuthCookies } from './oauth-cookie-relay'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/**
 * OAuth init/callback proxy (ADR-068, Option B — see `ai/models-talk.md`
 * "Iteration 2, slice 4"). Unlike `authenticated-proxy.ts`, this is
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
async function fetchUpstream(request: Request, upstreamPath: string): Promise<Response> {
  const upstream = new URL(`${API_URL}/api/v1${upstreamPath}`)
  upstream.search = new URL(request.url).search

  const hasBody = request.method === 'POST' && request.body !== null
  const headers = new Headers()
  const cookie = request.headers.get('cookie')
  if (cookie) headers.set('cookie', cookie)
  const acceptLanguage = request.headers.get('accept-language')
  if (acceptLanguage) headers.set('accept-language', acceptLanguage)
  const contentType = request.headers.get('content-type')
  if (hasBody && contentType) headers.set('content-type', contentType)

  return fetch(upstream, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    ...(hasBody ? { duplex: 'half' } : {}),
  })
}

function relayResponse(upstream: Response, provider: string): Response {
  const headers = new Headers()
  const location = upstream.headers.get('location')
  if (location) headers.set('location', location)
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  relayOAuthCookies(upstream, provider, headers)

  return new Response(upstream.body, { status: upstream.status, headers })
}

/** `GET /api/auth/oauth/:provider` -> backend `GET /auth/oauth/:provider`. */
export async function proxyOAuthAuthorize(request: Request, provider: string): Promise<Response> {
  const upstream = await fetchUpstream(request, `/auth/oauth/${encodeURIComponent(provider)}`)
  return relayResponse(upstream, provider)
}

/**
 * `GET|POST /api/auth/oauth/:provider/callback` -> backend
 * `GET|POST /auth/oauth/:provider/callback`. POST only applies to Apple's
 * `response_mode=form_post`; the raw `application/x-www-form-urlencoded`
 * body is forwarded unparsed.
 */
export async function proxyOAuthCallback(request: Request, provider: string): Promise<Response> {
  if (request.method === 'POST' && !isFormPostProvider(provider)) {
    return new Response(null, { status: 405 })
  }
  const upstream = await fetchUpstream(
    request,
    `/auth/oauth/${encodeURIComponent(provider)}/callback`
  )
  return relayResponse(upstream, provider)
}
