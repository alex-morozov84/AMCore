import { randomBytes } from 'node:crypto'

import { ContextRequestError } from './context-errors'
import { SessionVaultUnavailableError } from './errors'
import { type InvitationOAuthCarrier, invitationOAuthCarrierSchema } from './invitation-oauth-carrier'
import { invitationOAuthCarrierKey } from './invitation-oauth-store'
import { invitationOwnerKey } from './invitation-owner-store'
import { withInvitationStorage } from './invitation-storage'
import { type InvitationOwnerRecord,invitationOwnerRecordSchema } from './invitation-vault-record'
import { getWebRedisClient } from './redis-client'
import type { VaultRecord } from './session-vault.types'
import { VAULT_TTL_SECONDS } from './vault-constants'

import 'server-only'

const PUBLISH = `
local raw = redis.call('GET', KEYS[1])
local staged = redis.call('GET', KEYS[2])
if not raw or not staged or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
local current = cjson.decode(raw)
local next = cjson.decode(ARGV[2])
local session = cjson.decode(staged)
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if current.version ~= tonumber(ARGV[1]) or current.expiresAt <= now then return 0 end
if next.expiresAt ~= current.expiresAt or next.origin ~= current.origin then return 0 end
if session.ownerKey ~= KEYS[1] or session.deadline <= now then return 0 end
local matched = false
for _, flow in ipairs(next.flows) do
  if flow.binding.flowId == session.flowId and flow.state == 'completing_signin' then
    local handoff = flow.handoff
    if handoff and handoff ~= cjson.null and handoff.attemptId == session.attemptId
      and handoff.newSessionId == ARGV[3] and handoff.deadline == session.deadline
      and handoff.confirmed == false then matched = true end
  end
end
if not matched then return 0 end
if session.oauth then
  local carrierRaw = redis.call('GET', KEYS[4])
  if not carrierRaw then return 0 end
  local carrier = cjson.decode(carrierRaw)
  local expected = session.oauth.carrier
  if carrier.status ~= 'started' or carrier.expiresAt <= now then return 0 end
  if carrier.ownerHash ~= expected.ownerHash or carrier.flowId ~= session.flowId
    or carrier.attemptId ~= session.attemptId or carrier.fence ~= expected.fence
    or carrier.provider ~= expected.provider or carrier.ownerEpoch ~= current.epoch
    or carrier.origin ~= current.origin or carrier.reservedRevision ~= expected.reservedRevision
    or carrier.expectedInviteId ~= expected.expectedInviteId
    or carrier.expectedGeneration ~= expected.expectedGeneration
    or current.pendingOAuthAttemptId ~= carrier.attemptId
    or current.sessionBinding ~= cjson.null then return 0 end
  local bound = false
  for _, flow in ipairs(next.flows) do
    if flow.binding.flowId == session.flowId and flow.handoff ~= cjson.null
      and flow.handoff.ticketHash == session.oauth.ticketHash
      and flow.handoff.backendSessionId == session.oauth.backendSessionId then bound = true end
  end
  if not bound then return 0 end
  carrier.status = 'used'
  carrier.ticketHash = session.oauth.ticketHash
  carrier.backendSessionId = session.oauth.backendSessionId
  redis.call('SET', KEYS[4], cjson.encode(carrier), 'PXAT', carrier.expiresAt)
end
redis.call('SET', KEYS[3], cjson.encode(session.entry), 'EX', ARGV[4])
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', current.expiresAt)
redis.call('DEL', KEYS[2])
return 1
`

function stagingKey(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) throw new ContextRequestError(400, 'BAD_REQUEST')
  return `web:invitation:staged-session:v1:${sessionId}`
}

/** Staged credentials are inaccessible through the ordinary session vault until publication. */
export async function stageInvitationSession(input: {
  ownerHash: string
  flowId: string
  attemptId: string
  deadline: number
  entry: VaultRecord
  oauth?: { carrier: InvitationOAuthCarrier; ticketHash: string; backendSessionId: string }
}): Promise<string> {
  if (input.deadline <= Date.now() || input.deadline > Date.now() + 60000)
    throw new ContextRequestError(409, 'INVITE_FLOW_CHANGED')
  const sessionId = randomBytes(32).toString('base64url')
  if (input.oauth) {
    invitationOAuthCarrierSchema.parse(input.oauth.carrier)
    if (!/^[a-f0-9]{64}$/.test(input.oauth.ticketHash) ||
      input.oauth.carrier.ownerHash !== input.ownerHash || input.oauth.carrier.flowId !== input.flowId ||
      input.oauth.carrier.attemptId !== input.attemptId || input.oauth.carrier.status !== 'started')
      throw new ContextRequestError(409, 'INVITE_FLOW_CHANGED')
  }
  const record = {
    ownerKey: invitationOwnerKey(input.ownerHash),
    flowId: input.flowId,
    attemptId: input.attemptId,
    deadline: input.deadline,
    entry: { ...input.entry, version: 1 },
    ...(input.oauth ? { oauth: input.oauth } : {}),
  }
  await withInvitationStorage(async () => {
    const result = await (await getWebRedisClient()).set(stagingKey(sessionId), JSON.stringify(record), {
      condition: 'NX', expiration: { type: 'PXAT', value: input.deadline },
    })
    if (result !== 'OK') throw new SessionVaultUnavailableError(undefined)
  })
  return sessionId
}

/** Cookie emission follows this CAS; API confirmation still requires a separate browser ACK. */
export async function publishInvitationSession(
  ownerHash: string,
  expectedVersion: number,
  next: InvitationOwnerRecord,
  sessionId: string
  , oauthAttemptId?: string
): Promise<boolean> {
  const parsed = invitationOwnerRecordSchema.parse({ ...next, version: expectedVersion + 1 })
  return withInvitationStorage(async () => {
    const result = await (await getWebRedisClient()).eval(PUBLISH, {
      keys: [invitationOwnerKey(ownerHash), stagingKey(sessionId), `web:session:v1:${sessionId}`,
        ...(oauthAttemptId ? [invitationOAuthCarrierKey(oauthAttemptId)] : [])],
      arguments: [String(expectedVersion), JSON.stringify(parsed), sessionId, String(VAULT_TTL_SECONDS)],
    })
    return result === 1
  })
}

/** Failure cleanup only removes this owner's unpublished staging, never a published session. */
export async function discardInvitationSession(ownerHash: string, sessionId: string): Promise<void> {
  await withInvitationStorage(async () => {
    await (await getWebRedisClient()).eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      if cjson.decode(raw).ownerKey ~= ARGV[1] then return 0 end
      return redis.call('DEL', KEYS[1])
    `, { keys: [stagingKey(sessionId)], arguments: [invitationOwnerKey(ownerHash)] })
  })
}
