import { cookies } from 'next/headers'
import { AuthErrorCode, type OrganizationContextFamily } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { apiErrorResponse } from './api-error-response'
import { authFailureResponse } from './auth-failure-response'
import { isControlPlaneRoute, isCredentialRoute } from './credential-route'
import { ensureFreshSession } from './ensure-fresh-session'
import { isClosedOrganizationFamily } from './organization-family'
import { isTrustedOrigin } from './origin-guard'
import {
  frontendApiHeaders,
  isProductMutationTrusted,
  type ProductWebContext,
} from './product-web-context.server'
import { forwardRequestHeaders, forwardResponseHeaders } from './proxy-headers'
import { isQueueBoardRoute } from './queue-board-route'
import { SESSION_COOKIE_NAME } from './session-cookie'
import { redisVaultLock } from './session-lock'
import { redisVaultStore } from './session-vault-store'
import { createUpstreamRefresh } from './upstream-refresh'

import 'server-only'

const API_URL = getBackendBaseUrl()
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The generic authenticated Route Handler proxy (ADR-068): reads
 * `amcore_session`, ensures a fresh access token via the single-flight
 * protocol, and forwards the request to `apps/api` with both request and
 * response bodies streamed (not buffered) so multipart uploads and SSE
 * responses pass through unmodified.
 */
export async function proxyToBackend(
  request: Request,
  pathSegments: string[],
  organizationFamilies: readonly OrganizationContextFamily[] = [],
  context?: ProductWebContext
): Promise<Response> {
  const upstreamUrl = buildUpstreamUrl(pathSegments, request)
  if (
    (context?.audience === 'staff' && isControlPlaneRoute(upstreamUrl)) ||
    isCredentialRoute(upstreamUrl) ||
    isQueueBoardRoute(upstreamUrl) ||
    isClosedOrganizationFamily(upstreamUrl, organizationFamilies, API_URL)
  ) {
    return apiErrorResponse(request, { statusCode: 404, message: 'Not found' })
  }

  if (
    !SAFE_METHODS.has(request.method) &&
    !(context?.audience === 'staff'
      ? isProductMutationTrusted(request, context)
      : isTrustedOrigin(request))
  ) {
    return apiErrorResponse(request, {
      statusCode: 403,
      message: 'Request origin rejected',
      errorCode: AuthErrorCode.AUTH_ORIGIN_REJECTED,
    })
  }

  const sessionId = (await cookies()).get(context?.cookieName ?? SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return apiErrorResponse(request, { statusCode: 401, message: 'Not authenticated' })
  }

  let accessToken: string
  try {
    const session = await ensureFreshSession(sessionId, {
      store: context?.store ?? redisVaultStore,
      expectedAudience: context?.audience,
      lock: context?.lock ?? redisVaultLock,
      upstreamRefresh: createUpstreamRefresh(request.headers, context),
    })
    accessToken = session.accessToken
  } catch (error) {
    return authFailureResponse(request, error)
  }

  const hasBody = !SAFE_METHODS.has(request.method) && request.body !== null

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetchBackendResponse(upstreamUrl.toString(), request.headers, {
      method: request.method,
      headers: context
        ? frontendApiHeaders(context, forwardRequestHeaders(request.headers, accessToken))
        : forwardRequestHeaders(request.headers, accessToken),
      body: hasBody ? request.body : undefined,
      // Required by Node's fetch (undici) whenever `body` is a stream.
      ...(hasBody ? { duplex: 'half' } : {}),
    })
  } catch {
    return apiErrorResponse(request, {
      statusCode: 503,
      message: 'Backend temporarily unavailable',
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: forwardResponseHeaders(upstreamResponse.headers),
  })
}

function buildUpstreamUrl(pathSegments: string[], request: Request): URL {
  const upstream = new URL(`${API_URL}/api/v1/${pathSegments.map(encodeURIComponent).join('/')}`)
  upstream.search = new URL(request.url).search
  return upstream
}
