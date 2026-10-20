import { SessionVaultUnavailableError } from './errors'
import { getWebRedisClient } from './redis-client'
import { hasSessionAudience, type SessionAudience } from './session-audience'
import type { VaultEntry, VaultRecord, VaultStore } from './session-vault.types'
import { VAULT_TTL_SECONDS } from './vault-constants'

import 'server-only'

const CAS_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if ARGV[4] ~= '' and decoded.audience ~= ARGV[4] then
  if not (ARGV[4] == 'product' and decoded.audience == nil) then return 0 end
end
if tostring(decoded.version) ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`

function entryKey(namespace: string, sessionId: string): string {
  return `${namespace}:${sessionId}`
}

async function withVaultErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof SessionVaultUnavailableError) throw error
    throw new SessionVaultUnavailableError(error)
  }
}

/** Creates an isolated Redis vault store under an explicit session namespace. */
export function createRedisVaultStore<TRecord extends VaultRecord = VaultRecord>(
  namespace: string,
  expectedAudience?: SessionAudience
): VaultStore<TRecord> {
  return {
    async get(sessionId) {
      return withVaultErrors(async () => {
        const raw = await (await getWebRedisClient()).get(entryKey(namespace, sessionId))
        if (raw === null) return null
        const entry = JSON.parse(raw) as TRecord & Pick<VaultEntry, 'version'>
        return !expectedAudience || hasSessionAudience(entry, expectedAudience) ? entry : null
      })
    },

    async create(sessionId, entry) {
      if (expectedAudience && entry.audience && entry.audience !== expectedAudience)
        throw new Error('Session audience mismatch')
      return withVaultErrors(async () => {
        const versioned = {
          ...entry,
          ...(expectedAudience ? { audience: expectedAudience } : {}),
          version: 1,
        }
        await (
          await getWebRedisClient()
        ).set(entryKey(namespace, sessionId), JSON.stringify(versioned), {
          expiration: { type: 'EX', value: VAULT_TTL_SECONDS },
        })
      })
    },

    async setIfVersionMatches(sessionId, expectedVersion, entry) {
      if (expectedAudience && !hasSessionAudience(entry, expectedAudience)) return false
      return withVaultErrors(async () => {
        const versioned = {
          ...entry,
          ...(expectedAudience ? { audience: expectedAudience } : {}),
          version: expectedVersion + 1,
        }
        const reply = await (
          await getWebRedisClient()
        ).eval(CAS_SET_SCRIPT, {
          keys: [entryKey(namespace, sessionId)],
          arguments: [
            String(expectedVersion),
            JSON.stringify(versioned),
            String(VAULT_TTL_SECONDS),
            expectedAudience ?? '',
          ],
        })
        return reply === 1
      })
    },

    async delete(sessionId) {
      return withVaultErrors(async () => {
        await (await getWebRedisClient()).del(entryKey(namespace, sessionId))
      })
    },
  }
}
