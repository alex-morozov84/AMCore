import { randomBytes } from 'node:crypto'

import { invitationAdmissionResponseSchema, invitationFlowIdSchema } from '@amcore/shared'
import { z } from 'zod'

import { invitationOwnerKey } from './invitation-owner-store'
import { withInvitationStorage } from './invitation-storage'
import { type InvitationOwnerRecord,invitationOwnerRecordSchema } from './invitation-vault-record'
import { getWebRedisClient } from './redis-client'

import 'server-only'

const pendingSchema = z.strictObject({
  ownerKey: z.string(), origin: z.url(), deadline: z.number().int(), locale: z.string().max(16),
  admission: invitationAdmissionResponseSchema,
})
type PendingBootstrap = z.infer<typeof pendingSchema>
const ATTACH = `
local pendingRaw = redis.call('GET', KEYS[1])
local ownerRaw = redis.call('GET', KEYS[2])
if not pendingRaw or not ownerRaw then return 0 end
local pending = cjson.decode(pendingRaw)
local owner = cjson.decode(ownerRaw)
local next = cjson.decode(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if pending.ownerKey ~= KEYS[2] or pending.origin ~= owner.origin then return 0 end
if pending.deadline <= now or owner.expiresAt <= now then return 0 end
if owner.version ~= tonumber(ARGV[1]) then return 0 end
if next.origin ~= owner.origin or next.expiresAt ~= owner.expiresAt then return 0 end
local found = false
for _, flow in ipairs(next.flows) do
  if flow.binding.flowId == ARGV[3] and flow.credential == pending.admission.credential
    and flow.intent.expectedInviteId == pending.admission.intent.expectedInviteId
    and flow.intent.expectedGeneration == pending.admission.intent.expectedGeneration then found = true end
end
if not found then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', owner.expiresAt)
redis.call('DEL', KEYS[1])
return 1
`

function pendingKey(id: string): string {
  return `web:invitation:bootstrap:v1:${invitationFlowIdSchema.parse(id)}`
}

/** Only the admitted continuation is retained: the raw email token never enters storage. */
export async function saveInvitationBootstrap(
  ownerHash: string, origin: string, locale: string,
  admission: z.infer<typeof invitationAdmissionResponseSchema>, now: number
): Promise<string> {
  const id = randomBytes(16).toString('base64url')
  const pending = pendingSchema.parse({
    ownerKey: invitationOwnerKey(ownerHash), origin, locale, admission, deadline: now + 60000,
  })
  await withInvitationStorage(async () => {
    const result = await (await getWebRedisClient()).set(pendingKey(id), JSON.stringify(pending), {
      condition: 'NX', expiration: { type: 'PXAT', value: pending.deadline },
    })
    if (result !== 'OK') throw new Error('Bootstrap staging unavailable')
  })
  return id
}

/** The caller hashes the CURRENT cookie. A stale Set-Cookie candidate is never authority. */
export async function readInvitationBootstrap(
  id: string, currentOwnerHash: string, origin: string
): Promise<PendingBootstrap | null> {
  return withInvitationStorage(async () => {
    const raw = await (await getWebRedisClient()).get(pendingKey(id))
    if (!raw) return null
    const pending = pendingSchema.parse(JSON.parse(raw))
    return pending.ownerKey === invitationOwnerKey(currentOwnerHash) && pending.origin === origin &&
      pending.deadline > Date.now() ? pending : null
  })
}

/** Admission quotas and flow/session binding are calculated before this single-use owner CAS. */
export async function attachInvitationBootstrap(
  id: string, currentOwnerHash: string, expectedVersion: number,
  next: InvitationOwnerRecord, flowId: string
): Promise<boolean> {
  const parsed = invitationOwnerRecordSchema.parse({ ...next, version: expectedVersion + 1 })
  return withInvitationStorage(async () => {
    const result = await (await getWebRedisClient()).eval(ATTACH, {
      keys: [pendingKey(id), invitationOwnerKey(currentOwnerHash)],
      arguments: [String(expectedVersion), JSON.stringify(parsed), invitationFlowIdSchema.parse(flowId)],
    })
    return result === 1
  })
}
