import { NextResponse } from 'next/server'
import { browserBootstrapResultSchema } from '@amcore/shared'
import { z } from 'zod'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { apiErrorResponse } from './api-error-response'
import {
  createBrowserAuthAttempt,
  type InvitedBrowserAttempt,
  pendingAuthCookie,
  readBrowserAuthAttempt,
} from './browser-auth-attempt'
import {
  browserAnchorCookie,
  changedBrowserContext,
  privateBrowserHeaders,
  readBrowserAnchor,
  readBrowserCapability,
  unavailableBrowserContext,
} from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { isProductMutationTrusted, type ProductWebContext } from './product-web-context.server'
import { sessionMetadataHeaders } from './session-metadata-headers'

import 'server-only'

/** A no-credentials round trip must finish and echo its new anchor before any password submission. */
export async function handleBrowserBootstrap(
  request: Request,
  context: ProductWebContext
): Promise<NextResponse> {
  try {
    return await bootstrap(request, context)
  } catch (error) {
    if (!(error instanceof ContextRequestError) || error.errorCode !== 'AUTH_CONTEXT_CHANGED')
      throw error
    // Never adopt a replacement anchor. Clear local pointers only, then require another explicit sign-in.
    const response = apiErrorResponse(request, {
      statusCode: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
      message: 'Browser context changed; sign in again',
    })
    const pending = pendingAuthCookie(context)
    response.cookies.set(pending.name, '', { ...pending.options, maxAge: 0 })
    response.cookies.set(context.cookieName, '', { ...context.cookieOptions, maxAge: 0 })
    return response
  }
}

async function bootstrap(request: Request, context: ProductWebContext): Promise<NextResponse> {
  if (!isProductMutationTrusted(request, context))
    throw new ContextRequestError(403, 'AUTH_ORIGIN_REJECTED')
  if (
    new URL(request.url).search ||
    !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  if (
    !z
      .object({})
      .strict()
      .safeParse(await readContextJson(request.body, 2048)).success
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  return prepareBrowserAuthAttempt(request, context)
}

/** OAuth initiation also creates only neutral state; its provider redirect must round-trip these cookies. */
export async function prepareBrowserAuthAttempt(
  request: Request,
  context: ProductWebContext,
  invitation?: InvitedBrowserAttempt
): Promise<NextResponse> {
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (
    !anchor &&
    (readBrowserCapability(request.headers, context.cookieName) ||
      readBrowserCapability(request.headers, pendingAuthCookie(context).name))
  )
    throw changedBrowserContext()
  if (anchor) await readBrowserAuthAttempt(request.headers, context)
  const upstream = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/browser-publications/bootstrap`,
    request.headers,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...context.apiHeaders,
        ...sessionMetadataHeaders(request.headers),
        ...privateBrowserHeaders(context.audience),
        'content-type': 'application/json',
      },
      body: JSON.stringify(anchor ? { binding: anchor } : {}),
    }
  )
  if (!upstream.ok) throw unavailableBrowserContext()
  const parsed = browserBootstrapResultSchema.safeParse(await readContextJson(upstream.body, 2048))
  if (!parsed.success) throw unavailableBrowserContext()
  const result = parsed.data
  // An expired anchor with a visible flow/session cannot be silently replaced by a fresh context.
  if (
    anchor &&
    result.kind === 'created' &&
    (readBrowserCapability(request.headers, context.cookieName) ||
      readBrowserCapability(request.headers, pendingAuthCookie(context).name))
  )
    throw changedBrowserContext()
  const actual = result.kind === 'created' ? result.binding : anchor
  if (!actual) throw changedBrowserContext()
  const attempt = await createBrowserAuthAttempt(context, actual, result.view, invitation)
  const response = NextResponse.json({ attemptId: attempt.record.id, browser: result.view })
  response.headers.set('cache-control', 'private, no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  if (result.kind === 'created') {
    const cookie = browserAnchorCookie(context.audience)
    response.cookies.set(cookie.name, result.binding, cookie.options)
  }
  const pending = pendingAuthCookie(context)
  response.cookies.set(pending.name, attempt.handle, pending.options)
  return response
}
