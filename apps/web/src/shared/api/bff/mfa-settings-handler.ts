import { createHash } from 'node:crypto'

import { NextResponse } from 'next/server'
import {
  type MfaBrowserCommand,
  mfaSessionFlowResultSchema,
  mfaSettingsViewSchema,
  mfaStatusSchema,
} from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import { createSessionAuthAttempt, pendingAuthCookie } from './browser-auth-attempt'
import {
  browserSessionHeaders,
  changedBrowserContext,
  createBrowserBindingVerifier,
  readBrowserAnchor,
  readBrowserCapability,
  unavailableBrowserContext,
} from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { contextSessionBinding } from './context-session'
import { ensureFreshSession } from './ensure-fresh-session'
import type { ProductWebContext } from './product-web-context.server'
import { createUpstreamRefresh } from './upstream-refresh'

import 'server-only'

/** Current primary admission is mandatory, including before each original-family continuation command. */
export async function settingsSource(request: Request, context: ProductWebContext) {
  const id = readBrowserCapability(request.headers, context.cookieName)
  if (!id) throw changedBrowserContext()
  const entry = await ensureFreshSession(id, {
    store: context.store,
    lock: context.lock,
    expectedAudience: context.audience,
    upstreamRefresh: createUpstreamRefresh(request.headers, context),
    verifyBinding: createBrowserBindingVerifier(request.headers, context.audience),
  })
  const sourceFingerprint = createHash('sha256')
    .update(JSON.stringify(['mfa-settings-source-v1', id, entry.audience, entry.browser]))
    .digest('hex')
  return {
    entry,
    contextSession: contextSessionBinding(id, entry),
    sourceFingerprint,
    bindingHeaders: browserSessionHeaders(request.headers, context.audience, entry),
  }
}

async function callSettings(
  request: Request,
  context: ProductWebContext,
  source: Awaited<ReturnType<typeof settingsSource>>,
  body?: unknown
) {
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/mfa/${body ? 'session-flow' : 'settings'}`,
    request.headers,
    {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...context.apiHeaders,
        ...source.bindingHeaders,
        authorization: `Bearer ${source.entry.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  )
  if ([401, 409].includes(response.status)) throw changedBrowserContext()
  if (!response.ok) throw unavailableBrowserContext()
  return readContextJson(response.body, 16384)
}

export async function inspectMfaSettings(request: Request, context: ProductWebContext) {
  if (new URL(request.url).search) throw new ContextRequestError(400, 'BAD_REQUEST')
  const source = await settingsSource(request, context)
  return NextResponse.json({
    ...mfaSettingsViewSchema.parse(await callSettings(request, context, source)),
    contextSession: source.contextSession,
  })
}

export async function startMfaSettings(
  request: Request,
  context: ProductWebContext,
  command: MfaBrowserCommand
) {
  if (
    command.flowBinding ||
    command.password ||
    command.proof ||
    command.ticket ||
    command.generation
  )
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const purpose = command.action === 'start_code_rotation' ? 'rotate_codes' : 'replace_factor'
  if (!['start_code_rotation', 'start_replacement'].includes(command.action))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const source = await settingsSource(request, context)
  const result = mfaSessionFlowResultSchema.parse(
    await callSettings(request, context, source, {
      purpose,
      operationId: command.operationId,
    })
  )
  if (result.kind === 'limited')
    throw new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', result.retryAfter)
  if (result.kind === 'restart_required') throw changedBrowserContext()
  if (result.kind !== 'mfa') throw unavailableBrowserContext()
  if (
    !result.browser ||
    result.browser.contextId !== source.entry.browser?.contextId ||
    result.browser.generation !== source.entry.browser.generation ||
    result.purpose !== purpose
  )
    throw changedBrowserContext()
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (!anchor) throw changedBrowserContext()
  const created = await createSessionAuthAttempt(
    context,
    anchor,
    source.entry.userSnapshot.email,
    source.sourceFingerprint,
    result
  )
  const status = mfaStatusSchema.parse({
    kind: 'mfa',
    purpose: result.purpose,
    state: result.state,
    expiresAt: result.expiresAt,
    requiredProofs: result.requiredProofs,
    remainingCodes: result.remainingCodes,
    generation: result.generation,
  })
  const response = NextResponse.json({
    view: {
      ...status,
      kind: 'flow',
      flowBinding: created.record.id,
      accountLabel: created.record.accountLabel,
    },
  })
  const cookie = pendingAuthCookie(context)
  response.cookies.set(cookie.name, created.handle, cookie.options)
  return response
}
