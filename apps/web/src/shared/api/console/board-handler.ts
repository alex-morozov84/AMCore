import { BULL_BOARD_CONTENT_SECURITY_POLICY, BULL_BOARD_CONTEXT_HEADER } from '@amcore/shared'

import { apiErrorResponse } from '@/shared/api/bff/api-error-response'
import { AMCORE_CLIENT_IP_HEADER } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { resolveConsoleAccessToken } from './authenticated-proxy'
import { consoleBackgroundWorkPath } from './board-locale'
import {
  buildBoardRenderContext,
  buildBoardUpstreamUrl,
  encodeBoardRenderContext,
} from './board-upstream'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
const TIMEOUT_MS = 10_000

/** Request headers the board needs from the browser; everything else is dropped, never forwarded. */
const FORWARDED_REQUEST_HEADERS = ['accept', 'if-none-match', 'if-modified-since'] as const
/** Response headers that may reach the browser; `Set-Cookie`, `Location` and the rest never do. */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified'] as const

/** A browser navigation (page load), as opposed to an asset or a data request of the board UI. */
function isDocumentNavigation(request: Request): boolean {
  return (
    request.headers.get('sec-fetch-dest') === 'document' ||
    (request.headers.get('accept') ?? '').includes('text/html')
  )
}

/**
 * A page that cannot be shown: the Background work page says so (the only Console page that knows the
 * board), with a fixed marker. No detail about why — the Console must not reveal the upstream.
 */
function backToConsole(request: Request): Response {
  const location = `${consoleBackgroundWorkPath(request)}?board=unavailable`
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  })
}

/** Console hides what a non-operator must not know exists: a document without access is a plain 404. */
function hidden(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

function failure(request: Request, document: boolean, status: 401 | 403 | 404 | 503): Response {
  if (document) return status === 401 || status === 403 ? hidden() : backToConsole(request)
  return boardError(request, status, 'Queue board unavailable')
}

/** Our own errors need the same board policy as a forwarded response, without its upstream body. */
function boardError(request: Request, status: number, message: string): Response {
  const response = apiErrorResponse(request, { statusCode: status, message })
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status,
    headers: responseHeaders(response),
  })
}

function upstreamHeaders(request: Request, token: string, context: string): Headers {
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('Authorization', `Bearer ${token}`)
  headers.set(BULL_BOARD_CONTEXT_HEADER, context)
  const clientIp = resolveTrustedClientIp(request.headers)
  if (clientIp) headers.set(AMCORE_CLIENT_IP_HEADER, clientIp)
  return headers
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers()
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  const cacheControl = upstream.headers.get('cache-control')
  headers.set(
    'Cache-Control',
    cacheControl && /^private, no-(store|cache)$/.test(cacheControl)
      ? cacheControl
      : 'private, no-store'
  )
  headers.set('Content-Security-Policy', BULL_BOARD_CONTENT_SECURITY_POLICY)
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  // The board's own fixed policy, not the application's general one: a full Referer must never leave
  // a board page, and the document is neither sniffed nor framed.
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  return headers
}

/**
 * The read-only queue board, served through the Console session. A fixed bridge, not a proxy: the
 * upstream is the one board mount, the path and query are checked, the API token stays on the server,
 * no cookie or redirect crosses, and the board's own CSP must be present or nothing is served.
 */
export async function handleConsoleBoard(
  request: Request,
  segments: readonly string[]
): Promise<Response> {
  const document = isDocumentNavigation(request)
  const upstreamUrl = buildBoardUpstreamUrl(API_URL, segments, new URL(request.url).search)
  if (!upstreamUrl) return boardError(request, 404, 'Not found')

  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) {
    return failure(request, document, resolved.failure.status === 401 ? 401 : 503)
  }
  const context = buildBoardRenderContext(request)
  if (!context) return failure(request, document, 503)

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      redirect: 'manual',
      cache: 'no-store',
      headers: upstreamHeaders(request, resolved.token, encodeBoardRenderContext(context)),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    if (upstream.status === 401 || upstream.status === 403) {
      return failure(request, document, upstream.status)
    }
    const served = upstream.status === 200 || upstream.status === 304
    // Fail closed: a page that does not carry the board's own CSP is not served.
    if (
      !served ||
      upstream.headers.get('content-security-policy') !== BULL_BOARD_CONTENT_SECURITY_POLICY
    ) {
      const status = upstream.status === 404 && !document ? 404 : 503
      return failure(request, document, status)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    })
  } catch {
    return failure(request, document, 503)
  }
}
