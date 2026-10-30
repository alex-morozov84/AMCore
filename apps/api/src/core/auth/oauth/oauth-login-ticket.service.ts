import { Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'

import type {
  FrontendDestination,
  InvitationOAuthCorrelation,
  ProductAdminReturn,
  SystemRole,
} from '@amcore/shared'

import { AuthRedis } from '../../../infrastructure/redis/index.js'
import type { StoredInvitationIntent } from '../mfa/mfa-invitation-intent.js'
import type { OAuthIdentitySnapshot } from '../mfa/mfa-login-start.service.js'

const TICKET_TTL_MS = 60 * 1000
/** Per-call cap; the OAuth routes sit outside the admission stage and keep this limit. */
const CALL_DEADLINE_MS = 250

export interface OAuthLoginTicketClaims {
  frontend?: FrontendDestination
  placementFingerprint?: string
  callbackUri?: string
  returnTo?: ProductAdminReturn
  invitation?: InvitationOAuthCorrelation
  invitationIntent?: StoredInvitationIntent
  userId: string
  email: string
  systemRole: SystemRole
  sessionId: string
  browserAttemptId?: string
  identity?: OAuthIdentitySnapshot
  exchangeBindingHash?: string
}

@Injectable()
export class OAuthLoginTicketService {
  constructor(private readonly redis: AuthRedis) {}

  /** Redis failure becomes the typed 503; a failed `SET` may leave a TTL-limited orphan ticket. */
  async issue(claims: OAuthLoginTicketClaims): Promise<string> {
    const ticket = randomBytes(32).toString('base64url')

    await this.redis.call(
      (client) =>
        client.set(this.keyFor(ticket), JSON.stringify(claims), {
          expiration: { type: 'PX', value: TICKET_TTL_MS },
        }),
      CALL_DEADLINE_MS
    )

    return ticket
  }

  /** Redis failure becomes the typed 503 and is never replayed: the ticket may be consumed. */
  async consume(ticket: string): Promise<OAuthLoginTicketClaims | null> {
    const raw = await this.redis.call(
      (client) => client.getDel(this.keyFor(ticket)),
      CALL_DEADLINE_MS
    )
    if (!raw) return null

    try {
      return JSON.parse(raw) as OAuthLoginTicketClaims
    } catch {
      return null
    }
  }

  private keyFor(ticket: string): string {
    const hash = createHash('sha256').update(ticket).digest('hex')
    return `oauth:ticket:${hash}`
  }
}
