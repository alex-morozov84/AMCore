import { cookies } from 'next/headers'
import { AuthErrorCode } from '@amcore/shared'

import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'
import { forwardRequestHeaders, forwardResponseHeaders } from './proxy-headers'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { redisVaultStore } from './session-vault-store'
import { resolveTrustedClientIp } from './trusted-client-ip'
import { upstreamRefresh } from './upstream-refresh'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Backend routes whose success body is a bearer credential
// (`{ accessToken }`/`{ accessToken, refreshToken }`) and that have no
// dedicated Next.js Route Handler shadowing them ahead of this catch-all —
// `auth/login`, `auth/register`, and `auth/oauth/callback` do have one and
// so never reach this generic proxy in practice, but never assume that
// stays true; this list is the actual enforced boundary. Streaming any of
// these straight through to the browser would hand it a real backend
// credential (ADR-068's central invariant); the console's own step-up flow
// deliberately does not use this proxy at all (see
// `shared/api/console/step-up.ts`), and nothing else has a legitimate
// reason to call these from a browser through this path today.
const TOKEN_BEARING_PATHS = new Set(['auth/refresh', 'auth/step-up', 'auth/oauth/exchange'])

/**
 * The generic authenticated Route Handler proxy (ADR-068): reads
 * `amcore_session`, ensures a fresh access token via the single-flight
 * protocol, and forwards the request to `apps/api` with both request and
 * response bodies streamed (not buffered) so multipart uploads and SSE
 * responses pass through unmodified.
 */
export async function proxyToBackend(request: Request, pathSegments: string[]): Promise<Response> {
  if (TOKEN_BEARING_PATHS.has(pathSegments.join('/'))) {
    return apiErrorResponse(request, { statusCode: 404, message: 'Not found' })
  }

  if (!SAFE_METHODS.has(request.method) && !isTrustedOrigin(request)) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }

  let accessToken: string
  try {
    const session = await ensureFreshSession(sessionId, {
      store: redisVaultStore,
      lock: redisVaultLock,
      upstreamRefresh,
    })
    accessToken = session.accessToken
  } catch (error) {
    return authFailureResponse(request, error)
  }

  const upstreamUrl = buildUpstreamUrl(pathSegments, request)
  const hasBody = !SAFE_METHODS.has(request.method) && request.body !== null
  const trustedClientIp = resolveTrustedClientIp(request.headers)

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: forwardRequestHeaders(request.headers, accessToken, trustedClientIp),
    body: hasBody ? request.body : undefined,
    // Required by Node's fetch (undici) whenever `body` is a stream.
    ...(hasBody ? { duplex: 'half' } : {}),
  })

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

function buildUpstreamUrl(pathSegments: string[], request: Request): string {
  const upstream = new URL(`${API_URL}/api/v1/${pathSegments.map(encodeURIComponent).join('/')}`)
  upstream.search = new URL(request.url).search
  return upstream.toString()
}
