import { MEMBER_REQUEST_BYTES } from '@amcore/shared'

import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { CONTEXT_SESSION_HEADER } from './context-session'
import { isTrustedOrigin } from './origin-guard'

import 'server-only'

export function memberRouteInput(request: Request) {
  return {
    headers: request.headers,
    signal: request.signal,
    expectedSession: request.headers.get(CONTEXT_SESSION_HEADER) ?? undefined,
  }
}
export function memberRouteQuery(request: Request) {
  const query = new URL(request.url).searchParams
  const result: Record<string, string> = {}
  for (const [key, value] of query) {
    if (key in result) throw new ContextRequestError(400, 'BAD_REQUEST')
    result[key] = value
  }
  return result
}
export function memberRouteBody(request: Request) {
  if (!isTrustedOrigin(request)) throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
  if (
    new URL(request.url).search ||
    request.headers.has('content-encoding') ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return readContextJson(request.body, MEMBER_REQUEST_BYTES)
}
export function memberMethodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: 'GET, PATCH' } })
}
