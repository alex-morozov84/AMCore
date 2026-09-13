import { SessionVaultUnavailableError } from './errors'
import { getWebRedisClient } from './redis-client'
import type { VaultEntry, VaultRecord, VaultStore } from './session-vault.types'
import { VAULT_TTL_SECONDS } from './vault-constants'

import 'server-only'

const CAS_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
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
  namespace: string
): VaultStore<TRecord> {
  return {
    async get(sessionId) {
      return withVaultErrors(async () => {
        const raw = await (await getWebRedisClient()).get(entryKey(namespace, sessionId))
        return raw === null ? null : (JSON.parse(raw) as TRecord & Pick<VaultEntry, 'version'>)
      })
    },

    async create(sessionId, entry) {
      return withVaultErrors(async () => {
        const versioned = { ...entry, version: 1 }
        await (
          await getWebRedisClient()
        ).set(entryKey(namespace, sessionId), JSON.stringify(versioned), {
          expiration: { type: 'EX', value: VAULT_TTL_SECONDS },
        })
      })
    },

    async setIfVersionMatches(sessionId, expectedVersion, entry) {
      return withVaultErrors(async () => {
        const versioned = { ...entry, version: expectedVersion + 1 }
        const reply = await (
          await getWebRedisClient()
        ).eval(CAS_SET_SCRIPT, {
          keys: [entryKey(namespace, sessionId)],
          arguments: [
            String(expectedVersion),
            JSON.stringify(versioned),
            String(VAULT_TTL_SECONDS),
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
