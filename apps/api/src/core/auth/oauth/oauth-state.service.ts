import { Injectable } from '@nestjs/common'

import type {
  FrontendDestination,
  InvitationOAuthCorrelation,
  ProductAdminReturn,
  SupportedLocale,
} from '@amcore/shared'

import { AuthRedis } from '../../../infrastructure/redis/index.js'
import type { StoredInvitationIntent } from '../mfa/mfa-invitation-intent.js'
import { AuthStageService, nestedDeadlineMs, PUBLIC_STEP_MS } from '../stage/auth-stage.service.js'

import type { OAuthLinkAuthority } from './oauth-link-authority.js'

const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes
/** Per-call cap; the OAuth routes sit outside the admission stage and keep this limit. */
const CALL_DEADLINE_MS = 250

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
  constructor(
    private readonly redis: AuthRedis,
    private readonly stage: AuthStageService
  ) {}

  /**
   * Redis failure becomes the typed 503; nothing is retried. Each Redis phase is its own public
   * root (`PUBLIC_STEP_MS`): the provider HTTP exchange and the account commit around it keep
   * their own bounds and are never timed out by this root.
   */
  async store(state: string, data: OAuthStateData): Promise<void> {
    await this.stage.run(
      () =>
        this.redis.call(
          (client) =>
            client.set(`oauth:state:${state}`, JSON.stringify(data), {
              expiration: { type: 'PX', value: STATE_TTL_MS },
            }),
          nestedDeadlineMs(CALL_DEADLINE_MS)
        ),
      PUBLIC_STEP_MS
    )
  }

  /**
   * Atomically retrieve and delete (one-time use). Returns null if expired or not found.
   * Redis failure becomes the typed 503 and is never replayed: an unknown outcome may have
   * consumed the state, so sign-in must restart.
   */
  async consume(state: string): Promise<OAuthStateData | null> {
    const key = `oauth:state:${state}`
    const raw = await this.stage.run(
      () => this.redis.call((client) => client.getDel(key), nestedDeadlineMs(CALL_DEADLINE_MS)),
      PUBLIC_STEP_MS
    )
    if (!raw) return null

    try {
      return JSON.parse(raw) as OAuthStateData
    } catch {
      return null
    }
  }
}
