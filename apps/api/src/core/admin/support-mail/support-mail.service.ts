import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  type RequestPrincipal,
  SUPPORT_MAIL_KINDS,
  SupportMailErrorCode,
  type SupportMailKind,
  type SupportMailPreparation,
  type SupportMailStatus,
} from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import type { SupportMailAttempt } from '../../../generated/prisma/client.js'
import { EmailService } from '../../../infrastructure/email/email.service.js'
import { acquireXactLock } from '../../../prisma/index.js'
import { AuthMailLimiter } from '../../auth/auth-mail-limiter.service.js'
import { authMailClock } from '../../auth/auth-mail-token-lock.js'

import {
  ineligible,
  lifetime,
  MAIL_LIMITS,
  policyBinding,
  projectAttempt,
  recipientBinding,
  supportError,
  unavailable,
} from './support-mail.common.js'
import { SupportMailStore } from './support-mail.store.js'

@Injectable()
export class SupportMailService {
  constructor(
    private readonly store: SupportMailStore,
    private readonly env: EnvService,
    private readonly limiter: AuthMailLimiter,
    private readonly email: EmailService
  ) {}

  async status(actor: RequestPrincipal, targetId: string): Promise<SupportMailStatus> {
    return this.store.transaction(async (tx) => {
      const user = await this.store.admit(tx, actor, targetId)
      const ids: string[] = []
      for (const kind of SUPPORT_MAIL_KINDS) {
        const latest = await tx.supportMailAttempt.findFirst({
          where: { actorUserId: actor.sub, targetUserId: targetId, kind, claimedAt: { not: null } },
          orderBy: [{ claimedAt: 'desc' }, { id: 'desc' }],
        })
        if (latest) ids.push(latest.id)
      }
      const rows: SupportMailAttempt[] = []
      for (const id of ids.sort()) rows.push(await this.store.attempt(tx, actor, targetId, id))
      const now = await authMailClock(tx)
      const provider = this.env.get('EMAIL_PROVIDER') === 'resend' ? 'resend' : 'mock'
      const budgets = await Promise.all(
        SUPPORT_MAIL_KINDS.map(async (kind) => {
          try {
            return await this.limiter.status(user.emailCanonical, kind, actor.sub)
          } catch {
            return { reason: 'transport_unavailable' as const, retryAfterSeconds: 0 }
          }
        })
      )
      return {
        serverNow: now.toISOString(),
        provider,
        actions: SUPPORT_MAIL_KINDS.map((kind, index) => {
          const row = rows.find((item) => item.kind === kind)
          const budget = budgets[index]!
          const reason =
            ineligible(user, kind) ??
            (provider === 'mock' && this.env.get('NODE_ENV') === 'production'
              ? 'mock_in_production'
              : !this.email.supportsDirectSecretFence
                ? 'transport_unavailable'
                : budget.reason)
          return {
            kind,
            available: reason === null,
            unavailableReason: reason,
            retryAfterSeconds: reason === budget.reason ? budget.retryAfterSeconds : 0,
            latest: row && row.readUntil > now ? projectAttempt(row, now) : null,
            resultExpired: Boolean(row && row.readUntil <= now),
          }
        }),
      }
    })
  }

  async prepare(
    actor: RequestPrincipal,
    targetId: string,
    kind: SupportMailKind
  ): Promise<SupportMailPreparation> {
    // Access precedes the preparation budget; no anonymous counter writes.
    await this.store.transaction((tx) => this.store.admit(tx, actor, targetId))
    await this.limiter.prepare(actor.sub)
    return this.store.transaction(async (tx) => {
      const user = await this.store.admit(tx, actor, targetId, true)
      await acquireXactLock(tx, 'support-mail-prepare')
      const now = await authMailClock(tx)
      if (ineligible(user, kind))
        throw supportError(SupportMailErrorCode.SUPPORT_MAIL_NOT_ELIGIBLE, 409)
      const provider = this.env.get('EMAIL_PROVIDER') === 'resend' ? 'resend' : 'mock'
      if (
        !this.email.supportsDirectSecretFence ||
        (provider === 'mock' && this.env.get('NODE_ENV') === 'production')
      )
        throw unavailable()
      const outstanding = await tx.supportMailAttempt.count({
        where: { actorUserId: actor.sub, state: 'prepared', prepareExpiresAt: { gt: now } },
      })
      if (outstanding >= 20) throw supportError(SupportMailErrorCode.SUPPORT_MAIL_LIMIT, 429)
      if ((await tx.supportMailAttempt.count()) >= 10_000) throw unavailable()
      const expires = new Date(now.getTime() + MAIL_LIMITS.prepareMs)
      const row = await tx.supportMailAttempt.create({
        data: {
          id: randomUUID(),
          actorUserId: actor.sub,
          targetUserId: targetId,
          kind,
          provider,
          recipientBinding: recipientBinding(user),
          policyBinding: policyBinding(this.env),
          preparedAt: now,
          prepareExpiresAt: expires,
          readUntil: expires,
          purgeAfter: new Date(now.getTime() + MAIL_LIMITS.retentionMs),
        },
      })
      return {
        attemptId: row.id,
        kind,
        recipient: user.email,
        expiresAt: expires.toISOString(),
        linkLifetimeSeconds: lifetime(this.env, kind),
      }
    })
  }
}
