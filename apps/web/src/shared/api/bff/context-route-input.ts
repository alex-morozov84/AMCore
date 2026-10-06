import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { CONTEXT_SESSION_HEADER } from './context-session'
import { isTrustedOrigin } from './origin-guard'
import { trustedRequestOrigin } from './trusted-request-origin'

import 'server-only'

export function contextRouteInput(request: Request) {
  return { headers: request.headers, signal: request.signal,
    expectedSession: request.headers.get(CONTEXT_SESSION_HEADER) ?? undefined }
}
export function contextRouteQuery(request: Request, maxBytes?: number) {
  const url = new URL(request.url)
  if (maxBytes && new TextEncoder().encode(url.search).byteLength > maxBytes)
    throw new ContextRequestError(413, 'PAYLOAD_TOO_LARGE')
  const result: Record<string, string> = Object.create(null)
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) throw new ContextRequestError(400, 'BAD_REQUEST')
    result[key] = value
  }
  return result
}
export function assertContextMutationOrigin(request: Request, strict = false) {
  if (!isTrustedOrigin(request) || (strict && request.headers.get('origin') !== trustedRequestOrigin(request.headers, request.url)))
    throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
}
export function contextRouteBody(request: Request, bytes: number, strictOrigin = false) {
  assertContextMutationOrigin(request, strictOrigin)
  if (new URL(request.url).search || request.headers.has('content-encoding') ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return readContextJson(request.body, bytes)
}
