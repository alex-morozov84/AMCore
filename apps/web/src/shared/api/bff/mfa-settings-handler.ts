import { createHash } from 'node:crypto'

import { NextResponse } from 'next/server'
import { type MfaBrowserCommand, mfaSettingsViewSchema } from '@amcore/shared'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import {
  browserSessionHeaders,
  changedBrowserContext,
  createBrowserBindingVerifier,
  readBrowserCapability,
  unavailableBrowserContext,
} from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { contextSessionBinding } from './context-session'
import { ensureFreshSession } from './ensure-fresh-session'
import { settingsStartReceipt } from './mfa-settings-start-receipt'
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
  body?: unknown,
  path?: 'settings-start' | 'settings-start/abandon'
) {
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/mfa/${path ?? (body ? 'session-flow' : 'settings')}`,
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
  if (response.status === 429)
    throw new ContextRequestError(
      429,
      'RATE_LIMIT_EXCEEDED',
      parseRetryAfterSeconds(response.headers)
    )
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
  if (!['start_code_rotation', 'start_replacement'].includes(command.action))
    throw new ContextRequestError(400, 'BAD_REQUEST')
  const source = await settingsSource(request, context)
  return settingsStartReceipt(request, context, source, command, (path, body) =>
    callSettings(request, context, source, body, path)
  )
}

export async function resolveMfaSettingsStart(
  request: Request,
  context: ProductWebContext,
  command: MfaBrowserCommand
) {
  const source = await settingsSource(request, context)
  return settingsStartReceipt(
    request,
    context,
    source,
    command,
    (path, body) => callSettings(request, context, source, body, path),
    true
  )
}
