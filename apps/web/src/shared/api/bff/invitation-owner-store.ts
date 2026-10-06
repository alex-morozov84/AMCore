import { createHash } from 'node:crypto'

import { ContextRequestError } from './context-errors'
import { withInvitationStorage } from './invitation-storage'
import { type InvitationOwnerRecord,invitationOwnerRecordSchema } from './invitation-vault-record'
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
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', current.expiresAt)
return 1
`

export function invitationOwnerHash(proof: string): string {
  return createHash('sha256').update(proof).digest('hex')
}
export function invitationOwnerKey(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return `web:invitation:owner:v1:${hash}`
}

/** Owner mutations compare versions and preserve absolute expiry in the Redis transaction. */
export const invitationOwnerStore = {
  async create(hash: string, record: InvitationOwnerRecord): Promise<boolean> {
    const parsed = invitationOwnerRecordSchema.parse(record)
    if (parsed.version !== 1) throw new ContextRequestError(400, 'BAD_REQUEST')
    return withInvitationStorage(async () => {
      const result = await (
        await getWebRedisClient()
      ).set(invitationOwnerKey(hash), JSON.stringify(parsed), {
        condition: 'NX',
        expiration: { type: 'PXAT', value: parsed.expiresAt },
      })
      return result === 'OK'
    })
  },
  async get(hash: string, origin: string): Promise<InvitationOwnerRecord | null> {
    return withInvitationStorage(async () => {
      const raw = await (await getWebRedisClient()).get(invitationOwnerKey(hash))
      if (raw === null) return null
      const record = invitationOwnerRecordSchema.parse(JSON.parse(raw))
      if (record.origin !== origin || record.expiresAt <= Date.now()) return null
      return record
    })
  },
  async compareAndSet(
    hash: string,
    expectedVersion: number,
    next: InvitationOwnerRecord
  ): Promise<boolean> {
    const record = invitationOwnerRecordSchema.parse({ ...next, version: expectedVersion + 1 })
    return withInvitationStorage(async () => {
      const result = await (
        await getWebRedisClient()
      ).eval(OWNER_CAS, {
        keys: [invitationOwnerKey(hash)],
        arguments: [String(expectedVersion), JSON.stringify(record)],
      })
      return result === 1
    })
  },
}
