import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable } from '@nestjs/common'
import type { Cache } from 'cache-manager'

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
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async store(state: string, data: OAuthStateData): Promise<void> {
    await this.cache.set(`oauth:state:${state}`, data, STATE_TTL_MS)
  }

  /** Retrieve and delete (one-time use). Returns null if expired or not found. */
  async consume(state: string): Promise<OAuthStateData | null> {
    const key = `oauth:state:${state}`
    const data = await this.cache.get<OAuthStateData>(key)
    if (data) await this.cache.del(key)
    return data ?? null
  }
}
