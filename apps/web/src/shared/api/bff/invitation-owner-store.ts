import { createHash } from 'node:crypto'

import { ContextRequestError } from './context-errors'
import { invitationFlowChanged, retireInvitationFlows } from './invitation-flow-authority'
import { withInvitationStorage } from './invitation-storage'
import {
  assertInvitationSurface,
  invitationNamespace,
  invitationSurfaceData,
} from './invitation-surface'
import { type InvitationOwnerRecord, invitationOwnerRecordSchema } from './invitation-vault-record'
import type { ProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'

import 'server-only'

const OWNER_CAS = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
local incoming = cjson.decode(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if current.version ~= tonumber(ARGV[1]) or current.expiresAt <= now then return 0 end
if incoming.expiresAt ~= current.expiresAt or incoming.origin ~= current.origin then return 0 end
if incoming.frontend ~= current.frontend or incoming.audience ~= current.audience
  or incoming.placementFingerprint ~= current.placementFingerprint then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', current.expiresAt)
return 1
`

const RETIRE_STALE = `
local raw = redis.call('GET', KEYS[1])
if raw ~= ARGV[1] then return 0 end
local current = cjson.decode(raw)
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if current.expiresAt <= now then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', current.expiresAt)
return 1
`

export function invitationOwnerHash(proof: string): string {
  return createHash('sha256').update(proof).digest('hex')
}
export function invitationOwnerKey(hash: string, context?: ProductWebContext): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return `${invitationNamespace('owner', context)}:${hash}`
}

/** Owner mutations compare versions and preserve absolute expiry in the Redis transaction. */
export const invitationOwnerStore = {
  /** Cleanup only: old placement credentials never become live under the new placement. */
  async retireStaleForOrdinaryAuth(
    hash: string,
    origin: string,
    context?: ProductWebContext
  ): Promise<void> {
    if (context?.frontend !== 'admin') return
    await withInvitationStorage(async () => {
      const redis = await getWebRedisClient()
      const key = invitationOwnerKey(hash, context)
      const raw = await redis.get(key)
      if (raw === null) return
      const owner = invitationOwnerRecordSchema.parse(JSON.parse(raw))
      if (owner.origin !== origin || owner.expiresAt <= Date.now()) return
      if (owner.frontend !== 'admin' || owner.audience !== context.audience)
        throw invitationFlowChanged()
      if (owner.placementFingerprint === context.placementFingerprint) return
      const retired = invitationOwnerRecordSchema.parse({
        ...retireInvitationFlows(owner, owner.sessionBinding),
        version: owner.version + 1,
        placementFingerprint: context.placementFingerprint,
      })
      const result = await redis.eval(RETIRE_STALE, {
        keys: [key],
        arguments: [raw, JSON.stringify(retired)],
      })
      if (result !== 1) throw invitationFlowChanged()
    })
  },
  async create(
    hash: string,
    record: InvitationOwnerRecord,
    context?: ProductWebContext
  ): Promise<boolean> {
    const parsed = invitationOwnerRecordSchema.parse({
      ...record,
      ...invitationSurfaceData(context),
    })
    assertInvitationSurface(parsed, context)
    if (parsed.version !== 1) throw new ContextRequestError(400, 'BAD_REQUEST')
    return withInvitationStorage(async () => {
      const result = await (
        await getWebRedisClient()
      ).set(invitationOwnerKey(hash, context), JSON.stringify(parsed), {
        condition: 'NX',
        expiration: { type: 'PXAT', value: parsed.expiresAt },
      })
      return result === 'OK'
    })
  },
  async get(
    hash: string,
    origin: string,
    context?: ProductWebContext
  ): Promise<InvitationOwnerRecord | null> {
    return withInvitationStorage(async () => {
      const raw = await (await getWebRedisClient()).get(invitationOwnerKey(hash, context))
      if (raw === null) return null
      const record = invitationOwnerRecordSchema.parse(JSON.parse(raw))
      assertInvitationSurface(record, context)
      if (record.origin !== origin || record.expiresAt <= Date.now()) return null
      return record
    })
  },
  async compareAndSet(
    hash: string,
    expectedVersion: number,
    next: InvitationOwnerRecord,
    context?: ProductWebContext
  ): Promise<boolean> {
    const record = invitationOwnerRecordSchema.parse({ ...next, version: expectedVersion + 1 })
    assertInvitationSurface(record, context)
    return withInvitationStorage(async () => {
      const result = await (
        await getWebRedisClient()
      ).eval(OWNER_CAS, {
        keys: [invitationOwnerKey(hash, context)],
        arguments: [String(expectedVersion), JSON.stringify(record)],
      })
      return result === 1
    })
  },
}
