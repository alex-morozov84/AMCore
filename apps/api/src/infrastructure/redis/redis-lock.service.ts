import { Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'

import { REDIS_CLIENT } from './redis.constants'
import type { AppRedisClient } from './redis-connection.service'

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

// Token-checked lease renewal: extend the TTL only while we still own the lock.
const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`

export interface BlockingAcquireOptions {
  /** Max acquisition attempts including the first (default 10). */
  attempts?: number
  /** Base delay between attempts in ms; jittered to spread contention (default 200). */
  retryDelayMs?: number
}

const DEFAULT_ATTEMPTS = 10
const DEFAULT_RETRY_DELAY_MS = 200

/**
 * Best-effort mutual-exclusion lock over Redis (`SET NX PX` + token-checked
 * release/renew). It reduces contention and duplicate work; it is **not** a
 * correctness fence — a paused holder can lose its lease and resume, so any
 * correctness-sensitive consumer must additionally guard the protected resource
 * (e.g. a conditional DB update). See ADR-049.
 */
@Injectable()
export class RedisLockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomBytes(16).toString('base64url')
    const reply = await this.redis.set(key, token, {
      expiration: { type: 'PX', value: ttlMs },
      condition: 'NX',
    })

    return reply === 'OK' ? token : null
  }

  /** Acquire with bounded retry. Returns the owner token, or null if still held. */
  async acquireBlocking(
    key: string,
    ttlMs: number,
    options: BlockingAcquireOptions = {}
  ): Promise<string | null> {
    const attempts = options.attempts ?? DEFAULT_ATTEMPTS
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.acquire(key, ttlMs)
      if (token) return token
      if (attempt < attempts - 1) await this.sleep(this.jitter(retryDelayMs))
    }

    return null
  }

  /** Extend the lease only while `token` still owns `key`. True when renewed. */
  async renew(key: string, token: string, ttlMs: number): Promise<boolean> {
    const reply = await this.redis.eval(RENEW_LOCK_SCRIPT, {
      keys: [key],
      arguments: [token, String(ttlMs)],
    })

    return reply === 1
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [token],
    })
  }

  private jitter(baseMs: number): number {
    return baseMs + Math.floor(Math.random() * baseMs)
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
