import { invitationFlowIdSchema } from '@amcore/shared'

import { invitationFlowChanged } from './invitation-flow-authority'
import {
  type InvitationOAuthCarrier,
  invitationOAuthCarrierSchema,
} from './invitation-oauth-carrier'
import { invitationOwnerKey } from './invitation-owner-store'
import { withInvitationStorage } from './invitation-storage'
import { type InvitationOwnerRecord, invitationOwnerRecordSchema } from './invitation-vault-record'
import { getWebRedisClient } from './redis-client'

import 'server-only'

export function invitationOAuthCarrierKey(id: string) {
  return `web:invitation:oauth-attempt:v1:${invitationFlowIdSchema.parse(id)}`
}
const RESERVE = `
local raw = redis.call('GET', KEYS[1])
if not raw or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local owner = cjson.decode(raw)
local next = cjson.decode(ARGV[2])
local carrier = cjson.decode(ARGV[3])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if owner.version ~= tonumber(ARGV[1]) or owner.expiresAt <= now or carrier.expiresAt <= now then return 0 end
if owner.pendingOAuthAttemptId ~= cjson.null or owner.sessionBinding ~= cjson.null then return 0 end
if next.expiresAt ~= owner.expiresAt or next.origin ~= owner.origin or carrier.origin ~= owner.origin then return 0 end
if next.pendingOAuthAttemptId ~= carrier.attemptId or carrier.ownerEpoch ~= owner.epoch then return 0 end
local found = false
for _, flow in ipairs(next.flows) do
  if flow.binding.flowId == carrier.flowId and flow.state == 'authenticating' then
    local attempt = flow.attempt
    if attempt and attempt ~= cjson.null and attempt.id == carrier.attemptId
      and attempt.fence == carrier.fence and attempt.provider == carrier.provider
      and flow.binding.flowRevision == carrier.reservedRevision then found = true end
  end
end
if not found then return 0 end
redis.call('SET', KEYS[2], ARGV[3], 'PXAT', carrier.expiresAt)
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', owner.expiresAt)
return 1
`

export async function reserveInvitationOAuthCarrier(
  ownerHash: string,
  version: number,
  next: InvitationOwnerRecord,
  carrier: InvitationOAuthCarrier
): Promise<boolean> {
  const record = invitationOwnerRecordSchema.parse({ ...next, version: version + 1 })
  const parsed = invitationOAuthCarrierSchema.parse(carrier)
  if (parsed.ownerHash !== ownerHash || parsed.status !== 'reserved') throw invitationFlowChanged()
  return withInvitationStorage(
    async () =>
      (await (
        await getWebRedisClient()
      ).eval(RESERVE, {
        keys: [invitationOwnerKey(ownerHash), invitationOAuthCarrierKey(parsed.attemptId)],
        arguments: [String(version), JSON.stringify(record), JSON.stringify(parsed)],
      })) === 1
  )
}
export async function readInvitationOAuthCarrier(
  attemptId: string
): Promise<InvitationOAuthCarrier | null> {
  return withInvitationStorage(async () => {
    const raw = await (await getWebRedisClient()).get(invitationOAuthCarrierKey(attemptId))
    if (!raw) return null
    const carrier = invitationOAuthCarrierSchema.parse(JSON.parse(raw))
    return carrier.expiresAt > Date.now() ? carrier : null
  })
}

/** Starting is single-use and changes carrier plus owner attempt in one transaction. */
export async function startInvitationOAuthCarrier(
  ownerHash: string,
  version: number,
  next: InvitationOwnerRecord,
  carrier: InvitationOAuthCarrier
): Promise<boolean> {
  const record = invitationOwnerRecordSchema.parse({ ...next, version: version + 1 })
  return withInvitationStorage(
    async () =>
      (await (
        await getWebRedisClient()
      ).eval(
        `
    local ownerRaw = redis.call('GET', KEYS[1])
    local carrierRaw = redis.call('GET', KEYS[2])
    if not ownerRaw or not carrierRaw then return 0 end
    local owner = cjson.decode(ownerRaw)
    local carrier = cjson.decode(carrierRaw)
    local next = cjson.decode(ARGV[2])
    local time = redis.call('TIME')
    local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
    if owner.version ~= tonumber(ARGV[1]) or owner.expiresAt <= now then return 0 end
    if carrier.status ~= 'reserved' or carrier.createdAt + 60000 <= now or carrier.expiresAt <= now then return 0 end
    if carrier.ownerHash ~= ARGV[3] or carrier.fence ~= ARGV[4] or carrier.ownerEpoch ~= owner.epoch then return 0 end
    if next.expiresAt ~= owner.expiresAt or next.origin ~= owner.origin then return 0 end
    carrier.status = 'started'
    redis.call('SET', KEYS[2], cjson.encode(carrier), 'PXAT', carrier.expiresAt)
    redis.call('SET', KEYS[1], ARGV[2], 'PXAT', owner.expiresAt)
    return 1
  `,
        {
          keys: [invitationOwnerKey(ownerHash), invitationOAuthCarrierKey(carrier.attemptId)],
          arguments: [String(version), JSON.stringify(record), ownerHash, carrier.fence],
        }
      )) === 1
  )
}
