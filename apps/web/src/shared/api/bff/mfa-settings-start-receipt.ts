import { createHmac, randomBytes, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import {
  type MfaBrowserCommand,
  mfaSessionFlowResultSchema,
  mfaSettingsStartStatusSchema,
  mfaStatusSchema,
  passwordLoginPendingSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { createSessionAuthAttempt, pendingAuthCookie } from './browser-auth-attempt'
import {
  changedBrowserContext,
  readBrowserAnchor,
  unavailableBrowserContext,
} from './browser-binding.server'
import { ContextRequestError } from './context-errors'
import type { ProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'

import 'server-only'

const receiptSchema = z
  .object({
    version: z.number().int().positive(),
    operationId: z.string().uuid(),
    purpose: z.enum(['rotate_codes', 'replace_factor']),
    sourceFingerprint: z.string(),
    startNotAfter: z.iso.datetime(),
    expiresAt: z.number(),
    phase: z.enum(['prepared', 'dispatched', 'retained', 'abandoning', 'abandoned', 'refused']),
    refusal: z
      .object({ status: z.number().int(), errorCode: z.string(), retryAt: z.number().optional() })
      .strict()
      .optional(),
    handle: z.string(),
    id: z.string().uuid(),
    completionId: z.string().uuid(),
    vaultBinding: z.string(),
    result: passwordLoginPendingSchema.optional(),
  })
  .strict()
type Receipt = z.infer<typeof receiptSchema>
type Upstream = (
  path: 'settings-start' | 'settings-start/abandon',
  body: unknown
) => Promise<unknown>

function key(fingerprint: string, operationId: string, purpose: string) {
  const secret = process.env.WEB_FRONTEND_CONTEXT_KEY
  if (!secret || secret.length < 32) throw unavailableBrowserContext()
  return `web:mfa-settings-start:v1:${createHmac('sha256', secret)
    .update(JSON.stringify([fingerprint, operationId, purpose]))
    .digest('hex')}`
}
async function transition(name: string, current: Receipt, changes: Partial<Receipt>) {
  const next = receiptSchema.parse({ ...current, ...changes, version: current.version + 1 })
  const result = await (
    await getWebRedisClient()
  ).eval(
    `
    local raw = redis.call('GET', KEYS[1])
    if not raw or cjson.decode(raw).version ~= tonumber(ARGV[1]) then return 0 end
    redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[3]); return 1`,
    {
      keys: [name],
      arguments: [String(current.version), JSON.stringify(next), String(next.expiresAt)],
    }
  )
  if (result !== 1) throw unavailableBrowserContext()
  return next
}

async function expose(
  request: Request,
  context: ProductWebContext,
  record: Receipt,
  accountLabel: string
) {
  const result = record.result
  if (!result || record.phase !== 'retained') throw unavailableBrowserContext()
  const anchor = readBrowserAnchor(request.headers, context.audience)
  if (!anchor || record.expiresAt <= Date.now()) throw changedBrowserContext()
  const pending = await createSessionAuthAttempt(
    context,
    anchor,
    accountLabel,
    record.sourceFingerprint,
    result,
    record
  )
  const view = mfaStatusSchema.parse(result)
  const response = NextResponse.json({
    view: { ...view, kind: 'flow', accountLabel, flowBinding: pending.record.id },
  })
  const cookie = pendingAuthCookie(context)
  response.cookies.set(cookie.name, pending.handle, cookie.options)
  return response
}

/** Private material is persisted before dispatch and never recovered from the latest pending cookie. */
export async function settingsStartReceipt(
  request: Request,
  context: ProductWebContext,
  source: { sourceFingerprint: string; entry: { userSnapshot: { email: string } } },
  command: MfaBrowserCommand,
  upstream: Upstream,
  resolveOnly = false
) {
  const purpose = command.action === 'start_replacement' ? 'replace_factor' : 'rotate_codes'
  const name = key(source.sourceFingerprint, command.operationId, purpose)
  const redis = await getWebRedisClient()
  let raw = await redis.get(name)
  if (!raw && !resolveOnly) {
    const record: Receipt = {
      version: 1,
      operationId: command.operationId,
      purpose,
      sourceFingerprint: source.sourceFingerprint,
      startNotAfter: new Date(Date.now() + 30000).toISOString(),
      expiresAt: Date.now() + (purpose === 'replace_factor' ? 900000 : 300000),
      phase: 'prepared',
      handle: randomBytes(32).toString('base64url'),
      id: randomUUID(),
      completionId: randomUUID(),
      vaultBinding: randomBytes(32).toString('base64url'),
    }
    await redis.set(name, JSON.stringify(record), {
      condition: 'NX',
      expiration: { type: 'PXAT', value: record.expiresAt },
    })
    raw = await redis.get(name)
  }
  if (!raw) {
    const outcome = mfaSettingsStartStatusSchema.parse(
      await upstream('settings-start/abandon', { operationId: command.operationId, purpose })
    )
    if (!['abandoned', 'expired', 'advanced_unrecoverable'].includes(outcome.state))
      throw unavailableBrowserContext()
    return NextResponse.json({
      view: {
        kind: 'settings_start',
        state: outcome.state === 'advanced_unrecoverable' ? outcome.state : 'abandoned',
        operationId: command.operationId,
        purpose,
        accountLabel: source.entry.userSnapshot.email,
      },
    })
  }
  let record = receiptSchema.parse(JSON.parse(raw))
  if (
    record.sourceFingerprint !== source.sourceFingerprint ||
    record.operationId !== command.operationId ||
    record.purpose !== purpose ||
    record.expiresAt <= Date.now()
  )
    throw changedBrowserContext()
  if (record.phase === 'retained')
    return expose(request, context, record, source.entry.userSnapshot.email)
  if (record.phase === 'refused') {
    const refusal = record.refusal
    if (!refusal) throw unavailableBrowserContext()
    throw new ContextRequestError(
      refusal.status,
      refusal.errorCode,
      refusal.retryAt === undefined
        ? undefined
        : Math.max(0, Math.ceil((refusal.retryAt - Date.now()) / 1000))
    )
  }
  const input = { operationId: record.operationId, purpose, startNotAfter: record.startNotAfter }
  if (record.phase === 'prepared' && !resolveOnly) {
    record = await transition(name, record, { phase: 'dispatched' })
    let reply
    try {
      reply = mfaSessionFlowResultSchema.parse(await upstream('settings-start', input))
      if (reply.kind === 'limited')
        throw new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', reply.retryAfter)
      if (reply.kind === 'restart_required') throw changedBrowserContext()
    } catch (error) {
      if (error instanceof ContextRequestError && [401, 409, 429].includes(error.status))
        await transition(name, record, {
          phase: 'refused',
          refusal: {
            status: error.status,
            errorCode: error.errorCode,
            ...(error.retryAfterSeconds === undefined
              ? {}
              : { retryAt: Date.now() + error.retryAfterSeconds * 1000 }),
          },
        })
      throw error
    }
    if (reply.kind !== 'mfa') throw unavailableBrowserContext()
    record = await transition(name, record, {
      phase: 'retained',
      result: reply,
      expiresAt: Math.min(record.expiresAt, Date.parse(reply.expiresAt)),
    })
    return expose(request, context, record, source.entry.userSnapshot.email)
  }
  if (record.phase === 'abandoned')
    return NextResponse.json({
      view: {
        kind: 'settings_start',
        state: 'abandoned',
        operationId: record.operationId,
        purpose,
        accountLabel: source.entry.userSnapshot.email,
      },
    })
  if (record.phase !== 'abandoning')
    record = await transition(name, record, { phase: 'abandoning' })
  const outcome = mfaSettingsStartStatusSchema.parse(
    await upstream('settings-start/abandon', input)
  )
  if (outcome.state === 'advanced_unrecoverable')
    return NextResponse.json({
      view: {
        kind: 'settings_start',
        state: outcome.state,
        operationId: record.operationId,
        purpose,
        accountLabel: source.entry.userSnapshot.email,
      },
    })
  if (outcome.state !== 'abandoned' && outcome.state !== 'expired')
    throw unavailableBrowserContext()
  await transition(name, record, { phase: 'abandoned' })
  return NextResponse.json({
    view: {
      kind: 'settings_start',
      state: 'abandoned',
      operationId: record.operationId,
      purpose,
      accountLabel: source.entry.userSnapshot.email,
    },
  })
}
