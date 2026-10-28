import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { mfaSessionFlowResultSchema } from '@amcore/shared'
import {
  type BrowserContextView,
  browserRevisionSchema,
  type MfaFactorBindingResult,
  type MfaRecoveryTicketResult,
  passwordLoginPendingSchema,
} from '@amcore/shared'
import { z } from 'zod'

import {
  browserAnchorCookie,
  changedBrowserContext,
  readBrowserAnchor,
  readBrowserCapability,
} from './browser-binding.server'
import { SessionVaultUnavailableError } from './errors'
import type { ProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'
import type { VaultRecord } from './session-vault.types'
import { VAULT_TTL_SECONDS } from './vault-constants'

import 'server-only'

const credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const base = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    origin: z.string(),
    audience: z.enum(['product', 'staff', 'console']),
    anchorHash: z.string().regex(/^[a-f0-9]{64}$/),
    browser: browserRevisionSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict()
export const invitedBrowserAttemptSchema = z
  .object({
    ownerHash: z.string().regex(/^[a-f0-9]{64}$/),
    ownerEpoch: z.number().int().nonnegative(),
    flowId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    attemptId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    fence: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    cleanupKey: credential,
  })
  .strict()
export type InvitedBrowserAttempt = z.infer<typeof invitedBrowserAttemptSchema>
const ready = base
  .extend({
    state: z.enum(['ready', 'starting']),
    invitation: invitedBrowserAttemptSchema.optional(),
  })
  .strict()
const flow = base
  .extend({
    state: z.enum(['flow', 'issuing', 'cleanup_needed']),
    flow: passwordLoginPendingSchema,
    invitation: invitedBrowserAttemptSchema.optional(),
    oauthTicketHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sourceFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    accountLabel: z.string().max(254),
    completionId: z.string().uuid(),
    publicationCommandId: z.string().uuid().optional(),
    vaultBinding: credential,
  })
  .strict()
const staged = flow
  .extend({
    state: z.enum(['staged', 'published']),
    vaultId: credential,
    receipt: credential.nullable(),
    familyId: z.string().min(1).max(128),
    securityVersion: z.number().int().nonnegative(),
  })
  .strict()
export const browserAuthAttemptSchema = z.union([ready, flow, staged])
export type BrowserAuthAttempt = z.infer<typeof browserAuthAttemptSchema>
export type BrowserAuthFlow = z.infer<typeof flow>
export type BrowserAuthPublication = z.infer<typeof staged>

export function pendingAuthCookie(context: ProductWebContext) {
  return {
    ...browserAnchorCookie(context.audience),
    name:
      context.audience === 'product'
        ? 'amcore_auth_pending'
        : `__Host-amcore_${context.audience}_pending`,
  }
}
function anchorHash(anchor: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['browser-auth-attempt-v1', anchor]))
    .digest('hex')
}
function attemptKey(handle: string, context: ProductWebContext): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) throw changedBrowserContext()
  return `${context.namespace}:auth-attempt:${createHash('sha256').update(handle).digest('hex')}`
}
async function storage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SessionVaultUnavailableError) throw error
    throw new SessionVaultUnavailableError(undefined)
  }
}

export async function createBrowserAuthAttempt(
  context: ProductWebContext,
  anchor: string,
  view: BrowserContextView,
  invitation?: InvitedBrowserAttempt
) {
  const handle = randomBytes(32).toString('base64url')
  const record: BrowserAuthAttempt = {
    id: randomUUID(),
    version: 1,
    state: 'ready',
    ...(invitation ? { invitation } : {}),
    origin: context.origin,
    audience: context.audience,
    anchorHash: anchorHash(anchor),
    browser: { contextId: view.contextId, generation: view.generation },
    expiresAt: Math.min(Date.parse(view.expiresAt), Date.now() + 900000),
  }
  if (record.expiresAt <= Date.now()) throw changedBrowserContext()
  await storage(async () => {
    const result = await (
      await getWebRedisClient()
    ).set(attemptKey(handle, context), JSON.stringify(record), {
      condition: 'NX',
      expiration: { type: 'PXAT', value: record.expiresAt },
    })
    if (result !== 'OK') throw new SessionVaultUnavailableError(undefined)
  })
  return { handle, record }
}

/** A session operation keeps the published generation; only its API-validated successor may advance it. */
export async function createSessionAuthAttempt(
  context: ProductWebContext,
  anchor: string,
  accountLabel: string,
  sourceFingerprint: string,
  result: Extract<z.infer<typeof mfaSessionFlowResultSchema>, { kind: 'mfa' }>
) {
  if (!result.browser || !['rotate_codes', 'replace_factor'].includes(result.purpose))
    throw changedBrowserContext()
  const created = await createBrowserAuthAttempt(context, anchor, {
    ...result.browser,
    expiresAt: result.expiresAt,
    state: 'published',
  })
  const next: BrowserAuthFlow = {
    ...created.record,
    state: 'flow',
    accountLabel,
    sourceFingerprint,
    completionId: randomUUID(),
    vaultBinding: randomBytes(32).toString('base64url'),
    flow: result,
    expiresAt: Math.min(created.record.expiresAt, Date.parse(result.expiresAt)),
  }
  const record = await writeBrowserAuthAttempt(created.handle, created.record, next, context)
  if (record.state !== 'flow') throw changedBrowserContext()
  return { handle: created.handle, record }
}

export async function readBrowserAuthAttempt(
  source: Headers,
  context: ProductWebContext
): Promise<{ handle: string; record: BrowserAuthAttempt } | null> {
  const handle = readBrowserCapability(source, pendingAuthCookie(context).name)
  if (!handle) return null
  const raw = await storage(async () =>
    (await getWebRedisClient()).get(attemptKey(handle, context))
  )
  if (!raw) throw changedBrowserContext()
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new SessionVaultUnavailableError(undefined)
  }
  const record = browserAuthAttemptSchema.safeParse(decoded)
  const anchor = readBrowserAnchor(source, context.audience)
  if (
    !record.success ||
    !anchor ||
    record.data.anchorHash !== anchorHash(anchor) ||
    record.data.origin !== context.origin ||
    record.data.audience !== context.audience ||
    record.data.expiresAt <= Date.now()
  )
    throw changedBrowserContext()
  return { handle, record: record.data }
}

const CAS = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
local next = cjson.decode(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if current.version ~= tonumber(ARGV[1]) or current.expiresAt <= now then return 0 end
if next.id ~= current.id or next.origin ~= current.origin or next.audience ~= current.audience
  or next.anchorHash ~= current.anchorHash or next.browser.contextId ~= current.browser.contextId
  or next.expiresAt > current.expiresAt or next.expiresAt <= now then return 0 end
if #KEYS == 2 then
  if current.state ~= 'issuing' or next.state ~= 'staged' or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
  local entry = cjson.decode(ARGV[3])
  if entry.audience ~= next.audience or entry.browser.contextId ~= next.browser.contextId
    or entry.browser.generation ~= next.browser.generation or entry.browser.familyId ~= next.familyId
    or entry.browser.securityVersion ~= next.securityVersion then return 0 end
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', next.expiresAt)
return 1
`

/** One CAS stores a pending vault and its own completion journal. The primary DB still denies pending access. */
export async function updateBrowserAuthAttempt(
  handle: string,
  current: BrowserAuthAttempt,
  next: BrowserAuthAttempt,
  context: ProductWebContext,
  entry?: VaultRecord
): Promise<BrowserAuthAttempt> {
  const transitions: Record<BrowserAuthAttempt['state'], string[]> = {
    ready: ['starting'],
    starting: ['flow'],
    flow: ['flow', 'issuing'],
    issuing: ['staged', 'cleanup_needed'],
    staged: ['published'],
    published: [],
    cleanup_needed: [],
  }
  if (!transitions[current.state].includes(next.state)) throw changedBrowserContext()
  const generation =
    current.state === 'starting' ? current.browser.generation + 1 : current.browser.generation
  if (next.browser.generation !== generation) throw changedBrowserContext()
  if (
    'flow' in current &&
    (!('flow' in next) ||
      next.flow.continuation !== current.flow.continuation ||
      (next.completionId !== current.completionId &&
        !(current.state === 'flow' && next.state === 'issuing')) ||
      (next.publicationCommandId !== current.publicationCommandId &&
        !(current.state === 'flow' && next.state === 'issuing')) ||
      next.vaultBinding !== current.vaultBinding ||
      next.sourceFingerprint !== current.sourceFingerprint)
  )
    throw changedBrowserContext()
  return writeBrowserAuthAttempt(handle, current, next, context, entry)
}

/** Only a validated API seed-binding result may replace the retired predecessor capability. */
export async function retainSetupSuccessor(
  handle: string,
  current: BrowserAuthFlow,
  successor:
    | Extract<MfaFactorBindingResult, { outcome: 'bound' }>['successor']
    | Extract<MfaRecoveryTicketResult, { outcome: 'enrollment' }>['successor'],
  context: ProductWebContext
): Promise<BrowserAuthFlow> {
  if (
    current.state !== 'flow' ||
    !['initial_setup', 'replace_factor'].includes(current.flow.purpose) ||
    !successor.browser ||
    successor.browser.contextId !== current.browser.contextId ||
    successor.browser.generation !== current.browser.generation + 1 ||
    successor.continuation === current.flow.continuation
  )
    throw changedBrowserContext()
  const bound = 'backupCodes' in successor
  if (!bound && current.flow.nextAction !== 'recovery_ticket') throw changedBrowserContext()
  const expiresAt = Math.min(current.expiresAt, Date.parse(successor.expiresAt))
  const next: BrowserAuthFlow = {
    ...current,
    sourceFingerprint: undefined,
    expiresAt,
    browser: successor.browser,
    completionId: randomUUID(),
    publicationCommandId: undefined,
    vaultBinding: randomBytes(32).toString('base64url'),
    flow: {
      ...current.flow,
      purpose: 'initial_setup',
      continuation: successor.continuation,
      state: bound ? 'codes_pending' : 'enrollment_required',
      nextAction: 'enroll',
      browser: successor.browser,
      expiresAt: new Date(expiresAt).toISOString(),
      requiredProofs: [],
      remainingCodes: bound ? successor.backupCodes.codes.length : 0,
      generation: bound ? successor.backupCodes.generation : current.flow.generation,
    },
  }
  const retained = await writeBrowserAuthAttempt(handle, current, next, context)
  if (retained.state !== 'flow') throw changedBrowserContext()
  return retained
}

async function writeBrowserAuthAttempt(
  handle: string,
  current: BrowserAuthAttempt,
  next: BrowserAuthAttempt,
  context: ProductWebContext,
  entry?: VaultRecord
): Promise<BrowserAuthAttempt> {
  const parsed = browserAuthAttemptSchema.parse({ ...next, version: current.version + 1 })
  const keys = [attemptKey(handle, context)]
  if (entry) {
    if (parsed.state !== 'staged') throw changedBrowserContext()
    keys.push(`${context.namespace}:${parsed.vaultId}`)
  }
  const result = await storage(async () =>
    (await getWebRedisClient()).eval(CAS, {
      keys,
      arguments: [
        String(current.version),
        JSON.stringify(parsed),
        entry ? JSON.stringify({ ...entry, version: 1 }) : '',
        String(VAULT_TTL_SECONDS),
      ],
    })
  )
  if (result !== 1) throw changedBrowserContext()
  return parsed
}
