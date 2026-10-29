import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import { browserLogoutReceiptResultSchema, SUPPORTED_LOCALES } from '@amcore/shared'
import { z } from 'zod'

import { getConsoleOverviewHref, getConsolePublicPathname } from '@/shared/lib/console-public-href'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'

import {
  browserSessionHeaders,
  changedBrowserContext,
  readBrowserAnchor,
  readBrowserCapability,
  unavailableBrowserContext,
} from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { settingsSource } from './mfa-settings-handler'
import type { ProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'

import 'server-only'

const browserSchema = z
  .object({
    contextId: z.string(),
    generation: z.number().int(),
    familyId: z.string(),
    securityVersion: z.number().int(),
    audience: z.enum(['product', 'staff', 'console']),
  })
  .strict()
export const returnEntrySchema = z
  .object({
    version: z.number().int(),
    id: z.string().uuid(),
    operationId: z.string().uuid(),
    receiptSecret: z.string(),
    origin: z.string(),
    audience: z.enum(['product', 'staff', 'console']),
    anchorHash: z.string(),
    sourceFingerprint: z.string(),
    sourceIntent: z.string(),
    userId: z.string(),
    browser: browserSchema,
    destination: z.string(),
    locale: z.enum(SUPPORTED_LOCALES),
    expiresAt: z.number(),
    phase: z.enum(['prepared', 'logout_dispatched', 'logout_confirmed', 'claimed', 'superseded']),
    outcome: browserLogoutReceiptResultSchema.optional(),
    attemptId: z.string().uuid(),
    pendingHandle: z.string(),
  })
  .strict()
export type ConsoleReturnEntry = z.infer<typeof returnEntrySchema>
export const anchorDigest = (value: string) => createHash('sha256').update(value).digest('hex')
const key = (id: string, context: ProductWebContext) =>
  `${context.namespace}:console-return:v1:${z.string().uuid().parse(id)}`

/** A return destination is only an allowlisted Console page, never an auth capability. */
export function canonicalConsoleReturn(raw: string): string {
  const overview = getConsoleOverviewHref().replace(/\/$/, '')
  const publicPath = getConsolePublicPathname(raw)
  if (!publicPath || !publicPath.startsWith('/') || publicPath.startsWith('//'))
    return overview || '/'
  const path = publicPath.split('?')[0]!
  const suffix =
    path === overview ? '' : path.startsWith(`${overview}/`) ? path.slice(overview.length) : null
  if (
    suffix === null ||
    !/^\/(?:profile|users(?:\/[A-Za-z0-9_-]+)?|organizations(?:\/[A-Za-z0-9_-]+)?|audit|api-keys|integrations|scheduled-jobs|background-work)$/.test(
      suffix
    )
  )
    return overview || '/'
  return `${overview}${suffix}`
}

export async function loadReturnEntry(request: Request, context: ProductWebContext, id: string) {
  const raw = await (await getWebRedisClient()).get(key(id, context))
  if (!raw) return null
  const record = returnEntrySchema.parse(JSON.parse(raw))
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (
    !anchor ||
    record.anchorHash !== anchorDigest(anchor) ||
    record.origin !== context.origin ||
    record.audience !== context.audience
  )
    throw changedBrowserContext()
  return record.expiresAt > Date.now() ? record : null
}

export async function saveReturnEntry(
  context: ProductWebContext,
  current: ConsoleReturnEntry,
  changes: Partial<ConsoleReturnEntry>
) {
  const next = returnEntrySchema.parse({ ...current, ...changes, version: current.version + 1 })
  const saved = await (
    await getWebRedisClient()
  ).eval(
    `
    local raw = redis.call('GET', KEYS[1])
    if not raw or cjson.decode(raw).version ~= tonumber(ARGV[1]) then return 0 end
    redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[3]); return 1`,
    {
      keys: [key(current.id, context)],
      arguments: [String(current.version), JSON.stringify(next), String(next.expiresAt)],
    }
  )
  if (saved !== 1) throw unavailableBrowserContext()
  return next
}

export async function callLogoutReceipt(
  request: Request,
  context: ProductWebContext,
  record: ConsoleReturnEntry,
  path: 'logout-with-receipt' | 'logout-result' | 'return-claim',
  extra: { refreshToken?: string; neutralAttemptId?: string } = {},
  generation = record.browser.generation
) {
  const binding = { audience: context.audience, browser: { ...record.browser, generation } }
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/browser-publications/${path}`,
    request.headers,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...context.apiHeaders,
        ...browserSessionHeaders(request.headers, context.audience, binding),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        operationId: record.operationId,
        returnEntryId: record.id,
        receiptSecret: record.receiptSecret,
        ...(path === 'logout-with-receipt'
          ? { expiresAt: new Date(record.expiresAt).toISOString() }
          : {}),
        ...extra,
      }),
    }
  )
  if ([401, 403, 409].includes(response.status)) throw changedBrowserContext()
  if (!response.ok) throw unavailableBrowserContext()
  return browserLogoutReceiptResultSchema.parse(await readContextJson(response.body, 8192))
}

export async function createConsoleReturnEntry(request: Request, context: ProductWebContext) {
  const input = z
    .object({ destination: z.string().max(1024), locale: z.enum(SUPPORTED_LOCALES) })
    .strict()
    .parse(await readContextJson(request.body, 2048))
  const source = await settingsSource(request, context)
  const expected = request.headers.get('x-amcore-context-session')
  if (!expected || expected !== source.contextSession || !source.entry.browser)
    throw changedBrowserContext()
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (!anchor) throw changedBrowserContext()
  const record: ConsoleReturnEntry = {
    version: 1,
    id: randomUUID(),
    operationId: randomUUID(),
    receiptSecret: randomBytes(32).toString('base64url'),
    origin: context.origin,
    audience: context.audience,
    anchorHash: anchorDigest(anchor),
    sourceFingerprint: source.sourceFingerprint,
    sourceIntent: source.contextSession,
    userId: source.entry.userSnapshot.id,
    browser: source.entry.browser,
    destination: canonicalConsoleReturn(input.destination),
    locale: input.locale,
    expiresAt: Date.now() + 900000,
    phase: 'prepared',
    attemptId: randomUUID(),
    pendingHandle: randomBytes(32).toString('base64url'),
  }
  const saved = await (
    await getWebRedisClient()
  ).set(key(record.id, context), JSON.stringify(record), {
    condition: 'NX',
    expiration: { type: 'PXAT', value: record.expiresAt },
  })
  if (saved !== 'OK') throw unavailableBrowserContext()
  return NextResponse.json({ returnEntryId: record.id })
}

export async function logoutConsoleReturnEntry(request: Request, context: ProductWebContext) {
  const { returnEntryId } = z
    .object({ returnEntryId: z.string().uuid() })
    .strict()
    .parse(await readContextJson(request.body, 2048))
  let record = await loadReturnEntry(request, context, returnEntryId)
  if (!record) throw changedBrowserContext()
  let outcome
  if (record.phase === 'prepared') {
    const source = await settingsSource(request, context)
    if (
      source.sourceFingerprint !== record.sourceFingerprint ||
      source.contextSession !== record.sourceIntent ||
      request.headers.get('x-amcore-context-session') !== record.sourceIntent
    )
      throw changedBrowserContext()
    record = await saveReturnEntry(context, record, { phase: 'logout_dispatched' })
    outcome = await callLogoutReceipt(request, context, record, 'logout-with-receipt', {
      refreshToken: source.entry.refreshToken,
    })
    await context.store
      .delete(readBrowserCapability(request.headers, context.cookieName)!)
      .catch(() => undefined)
  } else outcome = await callLogoutReceipt(request, context, record, 'logout-result')
  if (
    outcome.beforeGeneration !== record.browser.generation ||
    outcome.contextId !== record.browser.contextId ||
    outcome.audience !== context.audience
  )
    throw changedBrowserContext()
  record = await saveReturnEntry(context, record, {
    outcome,
    phase: outcome.state === 'logged_out' ? 'logout_confirmed' : 'superseded',
  })
  // Exact server retirement suffices. This response deliberately sets/deletes no cookie.
  return NextResponse.json({ returnEntryId: record.id, state: outcome.state })
}
