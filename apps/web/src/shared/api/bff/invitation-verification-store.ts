import { randomBytes } from 'node:crypto'

import { invitationFlowBindingSchema, invitationFlowIdSchema } from '@amcore/shared'
import { z } from 'zod'

import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationOwnerKey } from './invitation-owner-store'
import { withInvitationStorage } from './invitation-storage'
import { getWebRedisClient } from './redis-client'

import 'server-only'

const selectorSchema = z.strictObject({ ownerHash: z.string().regex(/^[a-f0-9]{64}$/), origin: z.url(),
  binding: invitationFlowBindingSchema, ownerEpoch: z.number().int().nonnegative(), expiresAt: z.number().int() })
type Selector = z.infer<typeof selectorSchema>
function key(id: string) { return `web:invitation:verification-return:v1:${invitationFlowIdSchema.parse(id)}` }

export async function createInvitationVerificationSelector(input: Selector) {
  const record = selectorSchema.parse(input)
  if (!record.binding.sessionBinding || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + 1800000)
    throw invitationFlowChanged()
  const id = randomBytes(16).toString('base64url')
  await withInvitationStorage(async () => {
    const saved = await (await getWebRedisClient()).set(key(id), JSON.stringify(record),
      { condition: 'NX', expiration: { type: 'PXAT', value: record.expiresAt } })
    if (saved !== 'OK') throw invitationFlowChanged()
  })
  return id
}

export async function readInvitationVerificationSelector(id: string, ownerHash: string, origin: string) {
  return withInvitationStorage(async () => {
    const raw = await (await getWebRedisClient()).get(key(id))
    if (!raw) return null
    const record = selectorSchema.parse(JSON.parse(raw))
    return record.ownerHash === ownerHash && record.origin === origin && record.expiresAt > Date.now() ? record : null
  })
}

/** A mismatched browser, session or flow revision never consumes another selector. */
export async function consumeInvitationVerificationSelector(id: string, ownerHash: string, version: number, record: Selector) {
  return withInvitationStorage(async () => await (await getWebRedisClient()).eval(`
    local raw = redis.call('GET', KEYS[1])
    local ownerRaw = redis.call('GET', KEYS[2])
    if not raw or not ownerRaw or raw ~= ARGV[1] then return 0 end
    local selector = cjson.decode(raw)
    local owner = cjson.decode(ownerRaw)
    local time = redis.call('TIME')
    local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
    if selector.expiresAt <= now or owner.expiresAt <= now or owner.version ~= tonumber(ARGV[2]) then return 0 end
    if selector.ownerHash ~= ARGV[3] or selector.origin ~= owner.origin or selector.ownerEpoch ~= owner.epoch
      or selector.binding.sessionBinding ~= owner.sessionBinding then return 0 end
    for _, flow in ipairs(owner.flows) do
      if flow.binding.flowId == selector.binding.flowId and flow.binding.flowRevision == selector.binding.flowRevision
        and flow.binding.sessionBinding == selector.binding.sessionBinding and flow.state == 'active'
        and flow.expiresAt > now and (flow.handoff == cjson.null or flow.handoff.confirmed == true) then
        return redis.call('DEL', KEYS[1])
      end
    end
    return 0
  `, { keys: [key(id), invitationOwnerKey(ownerHash)], arguments: [JSON.stringify(selectorSchema.parse(record)), String(version), ownerHash] }) === 1)
}
