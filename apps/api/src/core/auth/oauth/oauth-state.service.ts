import { Inject, Injectable } from '@nestjs/common'

import type {
  FrontendDestination,
  InvitationOAuthCorrelation,
  ProductAdminReturn,
  SupportedLocale,
} from '@amcore/shared'

import { type AppRedisClient, REDIS_CLIENT } from '../../../infrastructure/redis/index.js'
import type { StoredInvitationIntent } from '../mfa/mfa-invitation-intent.js'

import type { OAuthLinkAuthority } from './oauth-link-authority.js'

const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface OAuthInvitationState {
  intent?: StoredInvitationIntent
  correlation: Omit<InvitationOAuthCorrelation, 'backendSessionId'>
  cleanupKeyHash: string
  expiresAt: string
}
export interface OAuthStateData {
  frontend?: FrontendDestination
  placementFingerprint?: string
  callbackUri?: string
  returnTo?: ProductAdminReturn
  browserAttemptId?: string
  pkceMethod?: 'S256'
  invitation?: OAuthInvitationState
  provider: string
  codeVerifier: string
  mode: 'login' | 'link'
  linkSource?: OAuthLinkAuthority
  userId?: string
  /**
   * Locale negotiated from `Accept-Language` when the login flow started (D2).
   * Seeds a newly created OAuth user's locale; never overwrites an existing
   * user. Absent for link flows (the user already exists).
   */
  locale?: SupportedLocale
  /**
   * SHA-256 of the browser-binding nonce (set as a `SameSite=Lax` cookie on the
   * initiating browser). Required so the callback can prove it runs in the same
   * browser that started the flow — see {@link hashOAuthStateNonce}. Stored
   * hashed; the raw nonce never touches Redis.
   */
  browserNonceHash: string
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
