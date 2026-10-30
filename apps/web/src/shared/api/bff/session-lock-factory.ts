import { randomBytes } from 'node:crypto'

import { SessionVaultUnavailableError } from './errors'
import type { VaultLock } from './session-vault.types'
import { runVaultRedis } from './vault-redis/vault-redis'
import { isVaultRedisUnavailable } from './vault-redis/vault-redis-failure'
import type { VaultRedisClient } from './vault-redis/vault-redis-types'

import 'server-only'

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`

/** Longest acquisition when the caller names none (the former bounded retry, ten tries). */
const DEFAULT_ACQUIRE_MS = 3000
/** Release is cleanup: its own short budget, independent of the caller. */
const RELEASE_DEADLINE_MS = 250
const MAX_ATTEMPTS = 10

function lockKey(namespace: string, sessionId: string): string {
  return `${namespace}:${sessionId}:lock`
}

async function lockCall<T>(
  operation: (client: VaultRedisClient) => Promise<T>,
  deadlineMs?: number
): Promise<T> {
  try {
    return await runVaultRedis((client) => operation(client), deadlineMs)
  } catch (error) {
    if (isVaultRedisUnavailable(error)) throw new SessionVaultUnavailableError(error)
    throw error
  }
}

async function releaseQuietly(namespace: string, sessionId: string, token: string): Promise<void> {
  try {
    await lockCall(
      (client) =>
        client.eval(RELEASE_SCRIPT, { keys: [lockKey(namespace, sessionId)], arguments: [token] }),
      RELEASE_DEADLINE_MS
    )
  } catch (error) {
    console.warn('[bff] Vault lock release failed; the lease will expire', {
      reason: error instanceof Error ? error.name : 'unknown',
    })
  }
}

/**
 * Bounded acquisition: tries until `deadlineMs` has passed, each attempt capped by what is left.
 * An attempt whose answer is unknown (its `SET NX` may have executed) releases its own token with
 * the cleanup budget, so a timed-out acquisition does not leave a lease nobody owns.
 */
async function acquireBounded(
  namespace: string,
  sessionId: string,
  ttlMs: number,
  deadlineMs: number
): Promise<string | null> {
  const until = Date.now() + deadlineMs
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = until - Date.now()
    if (remaining <= 0) return null
    const token = randomBytes(16).toString('base64url')
    let reply: string | null
    try {
      reply = await lockCall(
        (client) =>
          client.set(lockKey(namespace, sessionId), token, {
            expiration: { type: 'PX', value: ttlMs },
            condition: 'NX',
          }),
        remaining
      )
    } catch (error) {
      void releaseQuietly(namespace, sessionId, token)
      throw error
    }
    if (reply === 'OK') return token
    const pause = 200 + Math.random() * 200
    if (until - Date.now() <= pause) return null
    await new Promise((resolve) => setTimeout(resolve, pause))
  }
  return null
}

/** Creates a token-checked lock under the same namespace as its vault entries. */
export function createRedisVaultLock(namespace: string): VaultLock {
  return {
    acquire(sessionId, ttlMs, options) {
      return acquireBounded(namespace, sessionId, ttlMs, options?.deadlineMs ?? DEFAULT_ACQUIRE_MS)
    },
    async renew(sessionId, token, ttlMs, options) {
      const reply = await lockCall(
        (client) =>
          client.eval(RENEW_SCRIPT, {
            keys: [lockKey(namespace, sessionId)],
            arguments: [token, String(ttlMs)],
          }),
        options?.deadlineMs
      )
      return reply === 1
    },
    async release(sessionId, token) {
      await releaseQuietly(namespace, sessionId, token)
    },
  }
}
