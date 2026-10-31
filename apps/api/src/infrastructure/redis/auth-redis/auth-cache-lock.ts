import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AuthRedis } from './auth-redis.service.js'

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

/** Release is post-commit cleanup: it gets its own short budget, independent of the caller. */
const RELEASE_DEADLINE_MS = 250

/**
 * Stampede lock for authentication caches over the supervised client (`SET NX PX` plus a
 * token-checked release). It reduces duplicate work; it is not a correctness fence.
 *
 * `acquire` surfaces the typed 503 when Redis is unavailable. `release` never throws: a lost
 * release only leaves the lease to expire, and it must never replace the result of the work
 * it protected.
 */
@Injectable()
export class AuthCacheLock {
  constructor(
    private readonly redis: AuthRedis,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AuthCacheLock.name)
  }

  async acquire(key: string, ttlMs: number, deadlineMs?: number): Promise<string | null> {
    const token = randomBytes(16).toString('base64url')
    const reply = await this.redis.call(
      (client) =>
        client.set(key, token, { expiration: { type: 'PX', value: ttlMs }, condition: 'NX' }),
      deadlineMs
    )
    return reply === 'OK' ? token : null
  }

  async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.call(
        (client) => client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] }),
        RELEASE_DEADLINE_MS
      )
    } catch (err) {
      this.logger.warn({ err, key }, 'Auth cache lock release failed; the lease will expire')
    }
  }
}
