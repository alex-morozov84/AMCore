import { randomBytes } from 'node:crypto'

import { getWebRedisClient } from './redis-client'
import type { VaultLock } from './session-vault.types'

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

function lockKey(namespace: string, sessionId: string): string {
  return `${namespace}:${sessionId}:lock`
}

async function acquireBlocking(
  namespace: string,
  sessionId: string,
  ttlMs: number
): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = randomBytes(16).toString('base64url')
    const reply = await (
      await getWebRedisClient()
    ).set(lockKey(namespace, sessionId), token, {
      expiration: { type: 'PX', value: ttlMs },
      condition: 'NX',
    })
    if (reply === 'OK') return token
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 200))
  }
  return null
}

/** Creates a token-checked lock under the same namespace as its vault entries. */
export function createRedisVaultLock(namespace: string): VaultLock {
  return {
    acquire(sessionId, ttlMs) {
      return acquireBlocking(namespace, sessionId, ttlMs)
    },
    async renew(sessionId, token, ttlMs) {
      const reply = await (
        await getWebRedisClient()
      ).eval(RENEW_SCRIPT, {
        keys: [lockKey(namespace, sessionId)],
        arguments: [token, String(ttlMs)],
      })
      return reply === 1
    },
    async release(sessionId, token) {
      await (
        await getWebRedisClient()
      ).eval(RELEASE_SCRIPT, {
        keys: [lockKey(namespace, sessionId)],
        arguments: [token],
      })
    },
  }
}
