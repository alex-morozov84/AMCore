import { SessionVaultUnavailableError } from './errors'
import { getWebRedisClient } from './redis-client'
import type { VaultEntry, VaultStore } from './session-vault.types'

import 'server-only'

// Matches the backend refresh-token lifetime (ADR-007) — the vault entry
// should not outlive what a fresh login would produce. This TTL is a
// last-resort cleanup bound, not the primary revocation mechanism (see
// ADR-068's bounded-staleness decision for backend-session desync).
const VAULT_TTL_SECONDS = 7 * 24 * 60 * 60

// Atomic compare-and-set on the `version` field, guarding against a lock
// holder that lost its lease and resumed (RedisLockService/VaultLock is
// explicitly not a correctness fence on its own — see session-lock.ts).
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

function keyFor(sessionId: string): string {
  return `web:session:v1:${sessionId}`
}

async function withVaultErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof SessionVaultUnavailableError) throw error
    throw new SessionVaultUnavailableError(error)
  }
}

export const redisVaultStore: VaultStore = {
  async get(sessionId) {
    return withVaultErrors(async () => {
      const redis = await getWebRedisClient()
      const raw = await redis.get(keyFor(sessionId))
      return raw === null ? null : (JSON.parse(raw) as VaultEntry)
    })
  },

  async create(sessionId, entry) {
    return withVaultErrors(async () => {
      const redis = await getWebRedisClient()
      const versioned: VaultEntry = { ...entry, version: 1 }
      await redis.set(keyFor(sessionId), JSON.stringify(versioned), {
        expiration: { type: 'EX', value: VAULT_TTL_SECONDS },
      })
    })
  },

  async setIfVersionMatches(sessionId, expectedVersion, entry) {
    return withVaultErrors(async () => {
      const redis = await getWebRedisClient()
      const versioned: VaultEntry = { ...entry, version: expectedVersion + 1 }
      const reply = await redis.eval(CAS_SET_SCRIPT, {
        keys: [keyFor(sessionId)],
        arguments: [String(expectedVersion), JSON.stringify(versioned), String(VAULT_TTL_SECONDS)],
      })
      return reply === 1
    })
  },

  async delete(sessionId) {
    return withVaultErrors(async () => {
      const redis = await getWebRedisClient()
      await redis.del(keyFor(sessionId))
    })
  },
}
