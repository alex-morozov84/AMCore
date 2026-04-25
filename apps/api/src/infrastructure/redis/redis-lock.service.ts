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

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [token],
    })
  }
}
