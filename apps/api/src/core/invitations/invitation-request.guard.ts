import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { AuthErrorCode } from '@amcore/shared'

import { invitationJsonLimit } from '../../bootstrap/invitation-request-boundary.js'
import { AppException } from '../../common/exceptions/index.js'
import { GcraRedisLimiter } from '../../infrastructure/throttling/gcra-redis-limiter.service.js'

import { InvitationContinuationService } from './invitation-continuation.service.js'
import { invitationSecretHash } from './invitation-credential.js'

/** Additional scoped ceilings atop global IP admission; raw secrets never become limiter keys. */
@Injectable()
export class InvitationRequestGuard implements CanActivate {
  constructor(
    private readonly limiter: GcraRedisLimiter,
    private readonly continuation: InvitationContinuationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer; user?: { sub: string } }>()
    const url = req.originalUrl ?? req.url
    const path = req.path ?? url.split('?')[0] ?? ''
    const limit = invitationJsonLimit(url, '/api/v1')
    if (limit && (req.rawBody?.length ?? 0) > limit)
      throw new AppException('Invitation body budget exceeded', 413, 'PAYLOAD_TOO_LARGE')
    const hasBody =
      !!req.rawBody?.length ||
      Number(req.headers['content-length'] ?? 0) > 0 ||
      !!req.headers['transfer-encoding']
    if (
      (req.method === 'DELETE' ||
        /\/(?:context|confirm|abort)\/?$/.test(path) ||
        /\/continuations\/inspect\/?$/.test(path)) &&
      hasBody
    )
      throw new AppException('This operation requires an empty body', 400, 'VALIDATION_ERROR')
    const credential = req.headers['x-invitation-continuation']
    const keys: { key: string; rate: number; per: number }[] = []
    if (typeof credential === 'string')
      keys.push({
        key: `invite-continuation:${invitationSecretHash(credential)}`,
        rate: 60,
        per: 60000,
      })
    if (req.user && req.params.orgId && ['POST', 'DELETE'].includes(req.method))
      keys.push({ key: `invite-command:${req.user.sub}:${req.params.orgId}`, rate: 20, per: 60000 })
    if (/\/auth-handoffs\//.test(path))
      keys.push({
        key: `invite-handoff:${invitationSecretHash(String(req.params.attemptId ?? ''))}:${req.ip}`,
        rate: 60,
        per: 60000,
      })
    await this.consume(keys)
    if (/\/invites\/register\/?$/.test(path) && typeof credential === 'string') {
      await this.consume([{ key: `invite-register-ip:${req.ip}`, rate: 5, per: 3600000 }])
      const { email } = await this.continuation.context(credential)
      await this.consume([
        {
          key: `invite-register-email:${invitationSecretHash(email.toLowerCase())}`,
          rate: 5,
          per: 3600000,
        },
      ])
    }
    return true
  }

  private async consume(keys: { key: string; rate: number; per: number }[]): Promise<void> {
    for (const item of keys) {
      const decision = await this.limiter.consume(item.key, {
        rate: item.rate,
        per: item.per,
        burst: item.rate,
      })
      if (!decision.allowed)
        throw new AppException(
          'Invitation attempt budget exceeded',
          429,
          AuthErrorCode.RATE_LIMIT_EXCEEDED,
          { retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) }
        )
    }
  }
}
