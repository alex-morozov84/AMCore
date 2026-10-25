import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders, forwardResponseHeaders } from '@/shared/api/bff/proxy-headers'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = getBackendBaseUrl()
const TIMEOUT_MS = 4_000

/**
 * Fixed same-origin read for the live Background work refresh. It forwards to exactly one
 * backend route, never a client-supplied path, and the browser never sees a token. The
 * browser's abort (tab closed, auth lost) is forwarded; it cancels the HTTP request, not the
 * API's own bounded Redis reads.
 */
export async function handleConsoleQueues(request: Request): Promise<Response> {
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return resolved.failure
  try {
    const response = await fetchBackendResponse(
      `${API_URL}/api/v1/admin/background-work/queues`,
      request.headers,
      {
        method: 'GET',
        cache: 'no-store',
        headers: forwardRequestHeaders(request.headers, resolved.token),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      }
    )
    const headers = forwardResponseHeaders(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return apiErrorResponse(request, { statusCode: 503, message: 'Queue summary unavailable' })
  }
}
