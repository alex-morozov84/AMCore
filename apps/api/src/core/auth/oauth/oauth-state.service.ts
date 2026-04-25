import { Inject, Injectable } from '@nestjs/common'

import { type AppRedisClient, REDIS_CLIENT } from '../../../infrastructure/redis'

const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface OAuthStateData {
  provider: string
  codeVerifier: string
  mode: 'login' | 'link'
  userId?: string
}

/**
 * Stores OAuth state → { provider, codeVerifier } in Redis.
 * One-time use: consume() retrieves and deletes atomically.
 */
@Injectable()
export class OAuthStateService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  async store(state: string, data: OAuthStateData): Promise<void> {
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(data), {
      expiration: { type: 'PX', value: STATE_TTL_MS },
    })
  }

  /** Atomically retrieve and delete (one-time use). Returns null if expired or not found. */
  async consume(state: string): Promise<OAuthStateData | null> {
    const key = `oauth:state:${state}`
    const raw = await this.redis.getDel(key)
    if (!raw) return null

    try {
      return JSON.parse(raw) as OAuthStateData
    } catch {
      return null
    }
  }
}
