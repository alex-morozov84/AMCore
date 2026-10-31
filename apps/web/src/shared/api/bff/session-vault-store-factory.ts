import { SessionVaultUnavailableError } from './errors'
import { hasSessionAudience, type SessionAudience } from './session-audience'
import type { VaultEntry, VaultRecord, VaultStore } from './session-vault.types'
import { VAULT_TTL_SECONDS } from './vault-constants'
import { runVaultRedis } from './vault-redis/vault-redis'
import { isVaultRedisUnavailable } from './vault-redis/vault-redis-failure'
import type { VaultRedisClient } from './vault-redis/vault-redis-types'

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

/**
 * One bounded command on the supervised vault connection. A Redis outage-class failure (deadline,
 * capacity, a client that is not ready, transport or operational reply) is the unavailable error;
 * a programming or schema error stays visible. Nothing is retried.
 */
async function vaultCall<T>(
  operation: (client: VaultRedisClient) => Promise<T>,
  deadlineMs?: number
): Promise<T> {
  try {
    return await runVaultRedis((client) => operation(client), deadlineMs)
  } catch (error) {
    if (error instanceof SessionVaultUnavailableError) throw error
    if (isVaultRedisUnavailable(error)) throw new SessionVaultUnavailableError(error)
    throw error
  }
}

/** Creates an isolated Redis vault store under an explicit session namespace. */
export function createRedisVaultStore<TRecord extends VaultRecord = VaultRecord>(
  namespace: string,
  expectedAudience?: SessionAudience
): VaultStore<TRecord> {
  return {
    async get(sessionId, options) {
      const raw = await vaultCall(
        (client) => client.get(entryKey(namespace, sessionId)),
        options?.deadlineMs
      )
      if (raw === null) return null
      const entry = JSON.parse(raw) as TRecord & Pick<VaultEntry, 'version'>
      return !expectedAudience || hasSessionAudience(entry, expectedAudience) ? entry : null
    },

    async create(sessionId, entry, options) {
      if (expectedAudience && entry.audience && entry.audience !== expectedAudience)
        throw new Error('Session audience mismatch')
      const versioned = {
        ...entry,
        ...(expectedAudience ? { audience: expectedAudience } : {}),
        version: 1,
      }
      await vaultCall(
        (client) =>
          client.set(entryKey(namespace, sessionId), JSON.stringify(versioned), {
            expiration: { type: 'EX', value: VAULT_TTL_SECONDS },
          }),
        options?.deadlineMs
      )
    },

    async setIfVersionMatches(sessionId, expectedVersion, entry, options) {
      if (expectedAudience && !hasSessionAudience(entry, expectedAudience)) return false
      const versioned = {
        ...entry,
        ...(expectedAudience ? { audience: expectedAudience } : {}),
        version: expectedVersion + 1,
      }
      const reply = await vaultCall(
        (client) =>
          client.eval(CAS_SET_SCRIPT, {
            keys: [entryKey(namespace, sessionId)],
            arguments: [
              String(expectedVersion),
              JSON.stringify(versioned),
              String(VAULT_TTL_SECONDS),
              expectedAudience ?? '',
            ],
          }),
        options?.deadlineMs
      )
      return reply === 1
    },

    async delete(sessionId, options) {
      await vaultCall((client) => client.del(entryKey(namespace, sessionId)), options?.deadlineMs)
    },
  }
}
