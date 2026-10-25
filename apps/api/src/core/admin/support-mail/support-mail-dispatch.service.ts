import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  coerceSupportedLocale,
  frontendAuthPath,
  localizedFrontendUrl,
  type RequestPrincipal,
  SupportMailErrorCode,
  type SupportMailReceipt,
} from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import type { SupportMailAttempt } from '../../../generated/prisma/client.js'
import type { DirectSecretResult } from '../../../infrastructure/email/direct-secret-result.js'
import { EmailService } from '../../../infrastructure/email/email.service.js'
import { EmailTemplate } from '../../../infrastructure/email/email.types.js'
import { AuditLogService } from '../../audit/audit-log.service.js'
import { AuthMailLimiter } from '../../auth/auth-mail-limiter.service.js'
import { authMailClock } from '../../auth/auth-mail-token-lock.js'
import { assertSessionFresh } from '../../auth/session-freshness.js'
import { TokenManagerService } from '../../auth/token-manager.service.js'
import { resolveFrontendPlacement } from '../../frontend-context/frontend-placement.js'

import { recordSupportMail } from './support-mail.audit.js'
import {
  ineligible,
  MAIL_LIMITS,
  type MailUser,
  policyBinding,
  projectAttempt,
  recipientBinding,
  supportError,
  unavailable,
} from './support-mail.common.js'
import { SupportMailStore } from './support-mail.store.js'

type Claim = { row: SupportMailAttempt; user?: MailUser; token?: string; expiresAt?: Date }
type Execution = {
  actor: RequestPrincipal
  targetId: string
  claim: Claim
  t0: number
  closed: boolean
  abort: AbortController
}

@Injectable()
export class SupportMailDispatch {
  private physical = 0
  constructor(
    private readonly store: SupportMailStore,
    private readonly env: EnvService,
    private readonly tokens: TokenManagerService,
    private readonly limiter: AuthMailLimiter,
    private readonly email: EmailService,
    private readonly audit: AuditLogService
  ) {}

  async receipt(
    actor: RequestPrincipal,
    targetId: string,
    id: string
  ): Promise<SupportMailReceipt> {
    return this.store.transaction(async (tx) => {
      await this.store.admit(tx, actor, targetId)
      const row = await this.store.attempt(tx, actor, targetId, id)
      const now = await authMailClock(tx)
      if (row.readUntil <= now)
        throw supportError(SupportMailErrorCode.SUPPORT_MAIL_ATTEMPT_EXPIRED, 410)
      return row.state === 'prepared'
        ? { evidence: 'unconfirmed' as const, attemptId: id, tokenIssued: false }
        : projectAttempt(row, now)
    })
  }

  async run(actor: RequestPrincipal, targetId: string, id: string): Promise<SupportMailReceipt> {
    const existing = await this.store.transaction(async (tx) => {
      await this.store.admit(tx, actor, targetId)
      return this.store.attempt(tx, actor, targetId, id)
    })
    if (existing.state !== 'prepared') return this.receipt(actor, targetId, id)
    if (this.physical >= MAIL_LIMITS.physical) throw unavailable()
    this.physical += 1
    const t0 = performance.now()
    let claim: Claim
    try {
      claim = await this.claim(actor, targetId, id, t0)
    } catch (error) {
      this.physical -= 1
      throw error
    }
    if (!claim.token) {
      this.physical -= 1
      return this.safeReceipt(actor, targetId, id)
    }
    const execution: Execution = {
      actor,
      targetId,
      claim,
      t0,
      closed: false,
      abort: new AbortController(),
    }
    const physical = this.execute(execution).finally(() => {
      this.physical -= 1
    })
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(
        () => {
          execution.abort.abort()
          if (execution.closed) {
            resolve()
            return
          }
          execution.closed = true
          void this.settle(claim.row, { outcome: 'unknown', reason: 'provider_failure' }, true)
            .catch(() => undefined)
            .finally(resolve)
        },
        Math.max(0, MAIL_LIMITS.deadlineMs - (performance.now() - t0))
      )
    })
    try {
      await Promise.race([physical, deadline])
    } finally {
      clearTimeout(timer)
    }
    return this.safeReceipt(actor, targetId, id)
  }

  private async claim(
    actor: RequestPrincipal,
    targetId: string,
    id: string,
    t0: number
  ): Promise<Claim> {
    return this.store.transaction(async (tx) => {
      const user = await this.store.admit(tx, actor, targetId, true)
      const row = await this.store.attempt(tx, actor, targetId, id, true)
      if (row.state !== 'prepared') return { row }
      const now = await authMailClock(tx)
      await assertSessionFresh(tx, this.env.get('STEP_UP_MAX_AGE_SECONDS'), actor, now)
      if (row.prepareExpiresAt <= now)
        throw supportError(SupportMailErrorCode.SUPPORT_MAIL_ATTEMPT_EXPIRED, 410)
      if (
        row.recipientBinding !== recipientBinding(user) ||
        row.policyBinding !== policyBinding(this.env)
      )
        throw supportError(SupportMailErrorCode.SUPPORT_MAIL_BINDING_CHANGED, 409)
      if (ineligible(user, row.kind as 'email_verification' | 'password_recovery'))
        throw supportError(SupportMailErrorCode.SUPPORT_MAIL_NOT_ELIGIBLE, 409)
      if (
        !this.email.supportsDirectSecretFence ||
        (this.env.get('NODE_ENV') === 'production' && this.env.get('EMAIL_PROVIDER') === 'mock')
      )
        throw unavailable()
      await this.limiter.reserve(
        user.emailCanonical,
        row.kind as 'email_verification' | 'password_recovery',
        actor.sub
      )
      const issued = await authMailClock(tx)
      const remaining = MAIL_LIMITS.deadlineMs - (performance.now() - t0)
      if (remaining <= 0) throw unavailable()
      const frontend = {
        frontend: 'site' as const,
        placementFingerprint: resolveFrontendPlacement(this.env).placementFingerprint,
      }
      const generated =
        row.kind === 'password_recovery'
          ? await this.tokens.generatePasswordResetToken(user.id, frontend, tx)
          : await this.tokens.generateEmailVerificationToken(user.id, frontend, tx)
      const claimed = await tx.supportMailAttempt.update({
        where: { id },
        data: {
          state: 'claimed',
          ownerNonce: randomUUID(),
          claimedAt: issued,
          tokenIssuedAt: issued,
          tokenId: generated.id,
          deadlineAt: new Date(issued.getTime() + remaining),
          readUntil: new Date(issued.getTime() + MAIL_LIMITS.readMs),
          purgeAfter: new Date(issued.getTime() + MAIL_LIMITS.retentionMs),
        },
      })
      await recordSupportMail(this.audit, tx, 'requested', claimed, 'claimed')
      return { row: claimed, user, token: generated.token, expiresAt: generated.expiresAt }
    })
  }

  private async execute(execution: Execution): Promise<void> {
    const { claim } = execution
    try {
      if (execution.closed || performance.now() - execution.t0 >= MAIL_LIMITS.deadlineMs) return
      const reset = claim.row.kind === 'password_recovery'
      const template = reset ? EmailTemplate.PASSWORD_RESET : EmailTemplate.EMAIL_VERIFICATION
      const user = claim.user!
      const locale = coerceSupportedLocale(user.locale)
      const placement = resolveFrontendPlacement(this.env)
      const url = localizedFrontendUrl(
        placement.site,
        locale,
        frontendAuthPath('site', reset ? '/reset-password' : '/verify-email'),
        { token: claim.token! }
      )
      let rendered: Awaited<ReturnType<EmailService['renderTemplate']>>
      try {
        rendered = await this.email.renderTemplate(
          template,
          reset
            ? {
                name: user.name ?? user.email,
                resetUrl: url,
                expiresInMinutes: this.env.get('PASSWORD_RESET_EXPIRY_MINUTES'),
                locale,
              }
            : {
                name: user.name ?? user.email,
                verificationUrl: url,
                expiresInHours: this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS'),
                locale,
              },
          'direct'
        )
      } catch {
        if (!execution.closed) {
          execution.closed = true
          await this.settle(
            claim.row,
            { outcome: 'not_started', reason: 'precheck' },
            false,
            'render_failed'
          )
        }
        return
      }
      if (execution.closed) return
      const params = {
        to: user.email,
        ...rendered,
        idempotencyKey: `support-mail/${claim.row.id}`,
        signal: execution.abort.signal,
      }
      const fenceT0 = performance.now()
      const tokenRemainingMs = await this.fence(execution)
      if (tokenRemainingMs === null) {
        if (!execution.closed) {
          execution.closed = true
          await this.settle(claim.row, { outcome: 'not_started', reason: 'precheck' })
        }
        return
      }
      const result = await this.email.sendDirectSecret(params, template, () => {
        if (
          execution.closed ||
          execution.abort.signal.aborted ||
          performance.now() - execution.t0 >= MAIL_LIMITS.deadlineMs ||
          performance.now() - fenceT0 >= MAIL_LIMITS.fenceMs ||
          performance.now() - fenceT0 >= tokenRemainingMs
        )
          throw new Error('Secret transport admission expired')
      })
      if (!execution.closed) {
        execution.closed = true
        await this.settle(claim.row, result)
      }
    } catch {
      if (!execution.closed) {
        execution.closed = true
        await this.settle(claim.row, { outcome: 'unknown', reason: 'provider_failure' }).catch(
          () => undefined
        )
      }
    }
  }

  private async fence(execution: Execution): Promise<number | null> {
    return this.store.transaction(async (tx) => {
      const user = await this.store.admit(tx, execution.actor, execution.targetId, true)
      const row = await this.store.attempt(
        tx,
        execution.actor,
        execution.targetId,
        execution.claim.row.id,
        true
      )
      const token =
        row.kind === 'password_recovery'
          ? await tx.passwordResetToken.findUnique({ where: { id: row.tokenId! } })
          : await tx.emailVerificationToken.findUnique({ where: { id: row.tokenId! } })
      const now = await authMailClock(tx)
      await assertSessionFresh(tx, this.env.get('STEP_UP_MAX_AGE_SECONDS'), execution.actor, now)
      if (
        execution.closed ||
        row.state !== 'claimed' ||
        row.ownerNonce !== execution.claim.row.ownerNonce ||
        !row.deadlineAt ||
        row.deadlineAt <= now ||
        !token ||
        token.used ||
        token.expiresAt <= now ||
        row.recipientBinding !== recipientBinding(user) ||
        row.policyBinding !== policyBinding(this.env) ||
        ineligible(user, row.kind as 'email_verification' | 'password_recovery')
      )
        return null
      const changed = await tx.supportMailAttempt.update({
        where: { id: row.id },
        data: { state: 'dispatching', dispatchAt: now },
      })
      await recordSupportMail(this.audit, tx, 'dispatching', changed, 'dispatching')
      return token.expiresAt.getTime() - now.getTime()
    })
  }

  private async settle(
    row: SupportMailAttempt,
    result: DirectSecretResult,
    deadline = false,
    reason?: string
  ): Promise<void> {
    await this.store.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.support_mail_attempts WHERE id=${row.id}::uuid FOR UPDATE`
      const current = await tx.supportMailAttempt.findUnique({ where: { id: row.id } })
      if (
        !current ||
        current.ownerNonce !== row.ownerNonce ||
        current.tokenId !== row.tokenId ||
        !['claimed', 'dispatching'].includes(current.state)
      )
        return
      const now = await authMailClock(tx)
      const late = deadline || !current.deadlineAt || current.deadlineAt <= now
      const outcome = late
        ? current.state === 'claimed'
          ? 'not_started'
          : 'unknown'
        : current.state === 'claimed'
          ? 'not_started'
          : result.outcome
      const settled = await tx.supportMailAttempt.update({
        where: { id: row.id },
        data: {
          state: outcome,
          reason: late ? 'deadline' : (reason ?? result.reason),
          settledAt: now,
        },
      })
      await recordSupportMail(this.audit, tx, 'settled', settled, outcome, settled.reason)
    })
  }

  private async safeReceipt(
    actor: RequestPrincipal,
    targetId: string,
    id: string
  ): Promise<SupportMailReceipt> {
    try {
      return await this.receipt(actor, targetId, id)
    } catch {
      return { evidence: 'unconfirmed', attemptId: id, tokenIssued: true }
    }
  }
}
