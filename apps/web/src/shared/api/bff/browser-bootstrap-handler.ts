import { NextResponse } from 'next/server'
import { browserBootstrapResultSchema, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import { z } from 'zod'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import { apiErrorResponse } from './api-error-response'
import {
  type BrowserAuthAttempt,
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
// AMCORE_CONSOLE_RETURN_IMPORT_START
import { claimConsoleReturn } from './console-return-claim'
// AMCORE_CONSOLE_RETURN_IMPORT_END
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { currentFlowView } from './mfa-flow-view'
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
    // This response may arrive after another login. Never delete its cookies.
    const response = apiErrorResponse(request, {
      statusCode: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
      message: 'Browser context changed; sign in again',
    })
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
  const input = z
    .object({
      entryId: z.string().uuid().optional(),
      // AMCORE_CONSOLE_RETURN_INPUT_START
      returnEntryId: z.string().uuid().optional(),
      entryKind: z.literal('console').optional(),
      // AMCORE_CONSOLE_RETURN_INPUT_END
      locale: z.enum(SUPPORTED_LOCALES).optional(),
    })
    .strict()
    .safeParse(await readContextJson(request.body, 2048))
  if (!input.success) throw new ContextRequestError(400, 'BAD_REQUEST')
  // AMCORE_CONSOLE_RETURN_VALIDATION_START
  if (input.data.returnEntryId && !input.data.entryKind)
    throw new ContextRequestError(400, 'BAD_REQUEST')
  // AMCORE_CONSOLE_RETURN_VALIDATION_END
  return prepareBrowserAuthAttempt(request, context, undefined, input.data)
}

/** OAuth initiation also creates only neutral state; its provider redirect must round-trip these cookies. */
export async function prepareBrowserAuthAttempt(
  request: Request,
  context: ProductWebContext,
  invitation?: InvitedBrowserAttempt,
  entry?: {
    entryId?: string
    // AMCORE_CONSOLE_RETURN_TYPE_START
    returnEntryId?: string
    entryKind?: 'console'
    // AMCORE_CONSOLE_RETURN_TYPE_END
    locale?: (typeof SUPPORTED_LOCALES)[number]
  }
): Promise<NextResponse> {
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (
    !anchor &&
    (readBrowserCapability(request.headers, context.cookieName) ||
      readBrowserCapability(request.headers, pendingAuthCookie(context).name))
  )
    throw changedBrowserContext()
  if (anchor) {
    const pending = await readBrowserAuthAttempt(request.headers, context, { allowExpired: true })
    if (
      pending &&
      !pending.record.cancelled &&
      'flow' in pending.record &&
      !['published', 'cleanup_needed'].includes(pending.record.state) &&
      !['completed', 'cancelled', 'restart_required', 'expired'].includes(pending.record.flow.state)
    ) {
      let live = true
      try {
        const status = await currentFlowView(request, context, pending.record)
        live =
          status.kind !== 'flow' ||
          !['completed', 'cancelled', 'restart_required', 'expired'].includes(status.state)
      } catch (error) {
        // Only an authoritative refusal makes this exact old continuation inert.
        if (!(error instanceof ContextRequestError) || error.errorCode !== 'AUTH_CONTEXT_CHANGED')
          throw error
        live = false
      }
      if (live) {
        if (entry?.entryId && !invitation)
          return NextResponse.json({ kind: 'resume_required', flowBinding: pending.record.id })
        throw changedBrowserContext()
      }
    }
  }
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
  if (upstream.status === 429)
    throw new ContextRequestError(
      429,
      'RATE_LIMIT_EXCEEDED',
      parseRetryAfterSeconds(upstream.headers)
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
  let returnIdentity: { id: string; handle: string } | undefined
  let navigation: BrowserAuthAttempt['consoleEntry']
  // AMCORE_CONSOLE_RETURN_BINDING_START
  if (entry?.entryKind === 'console') {
    const returned =
      entry.returnEntryId && !invitation
        ? await claimConsoleReturn(request, context, entry.returnEntryId, result.view)
        : undefined
    if (returned)
      returnIdentity = { id: returned.record.attemptId, handle: returned.record.pendingHandle }
    navigation = {
      locale: returned?.record.locale ?? entry.locale ?? DEFAULT_LOCALE,
      ...(returned ? { proof: returned.proof } : {}),
    }
  }
  // AMCORE_CONSOLE_RETURN_BINDING_END
  const attempt = await createBrowserAuthAttempt(
    context,
    actual,
    result.view,
    invitation,
    returnIdentity,
    navigation
  )
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
