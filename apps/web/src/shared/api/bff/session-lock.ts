import { randomBytes } from 'node:crypto'

import { getWebRedisClient } from './redis-client'
import type { VaultLock } from './session-vault.types'

import 'server-only'

// Same token-checked SET NX PX / release / renew technique as
// apps/api/src/infrastructure/redis/redis-lock.service.ts — duplicated
// rather than shared because apps/web and apps/api are separate deployable
// packages with no shared server-infra package boundary. Also **not a
// correctness fence** on its own for the same reason as the backend's
// version: `VaultStore.setIfVersionMatches` is the real guard against a
// lock holder that paused and resumed after losing its lease.
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

function lockKeyFor(sessionId: string): string {
  return `web:session:v1:${sessionId}:lock`
}

async function acquireOnce(sessionId: string, ttlMs: number): Promise<string | null> {
  const redis = await getWebRedisClient()
  const token = randomBytes(16).toString('base64url')

  const reply = await redis.set(lockKeyFor(sessionId), token, {
    expiration: { type: 'PX', value: ttlMs },
    condition: 'NX',
  })

  return reply === 'OK' ? token : null
}

export const redisVaultLock: VaultLock = {
  // `acquire` embeds bounded retry-with-jitter so every VaultLock consumer
  // gets the same "try hard, then give up" contract without special-casing
  // the real implementation.
  async acquire(sessionId, ttlMs) {
    return acquireBlocking(sessionId, ttlMs)
  },

  async renew(sessionId, token, ttlMs) {
    const redis = await getWebRedisClient()
    const reply = await redis.eval(RENEW_SCRIPT, {
      keys: [lockKeyFor(sessionId)],
      arguments: [token, String(ttlMs)],
    })

    return reply === 1
  },

  async release(sessionId, token) {
    const redis = await getWebRedisClient()
    await redis.eval(RELEASE_SCRIPT, {
      keys: [lockKeyFor(sessionId)],
      arguments: [token],
    })
  },
}

/** Bounded-retry acquire, mirroring the backend's `acquireBlocking`. */
async function acquireBlocking(
  sessionId: string,
  ttlMs: number,
  attempts = 10,
  retryDelayMs = 200
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const token = await acquireOnce(sessionId, ttlMs)
    if (token) return token
    if (attempt < attempts - 1) {
      const jittered = retryDelayMs + Math.floor(Math.random() * retryDelayMs)
      await new Promise((resolve) => setTimeout(resolve, jittered))
    }
  }

  return null
}
