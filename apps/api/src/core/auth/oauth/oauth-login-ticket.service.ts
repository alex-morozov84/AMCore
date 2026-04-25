import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'

import type { SystemRole } from '@amcore/shared'

import { type AppRedisClient, REDIS_CLIENT } from '../../../infrastructure/redis'

const TICKET_TTL_MS = 60 * 1000

export interface OAuthLoginTicketClaims {
  userId: string
  email: string
  systemRole: SystemRole
  sessionId: string
}

@Injectable()
export class OAuthLoginTicketService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  async issue(claims: OAuthLoginTicketClaims): Promise<string> {
    const ticket = randomBytes(32).toString('base64url')

    await this.redis.set(this.keyFor(ticket), JSON.stringify(claims), {
      expiration: { type: 'PX', value: TICKET_TTL_MS },
    })

    return ticket
  }

  async consume(ticket: string): Promise<OAuthLoginTicketClaims | null> {
    const raw = await this.redis.getDel(this.keyFor(ticket))
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
