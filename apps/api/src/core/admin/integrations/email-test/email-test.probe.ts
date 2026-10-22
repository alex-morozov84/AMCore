import { createHash, randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  type IntegrationAction,
  IntegrationErrorCode,
  type IntegrationEvidence,
  type ProbePreparation,
  type ProbeReceipt,
  ResourceErrorCode,
} from '@amcore/shared'

import { AppException } from '../../../../common/exceptions/index.js'
import { EnvService } from '../../../../env/env.service.js'
import { AuditActorType, AuditTargetType } from '../../../../generated/prisma/client.js'
import type { EmailProvider } from '../../../../infrastructure/email/email.types.js'
import { PrismaService } from '../../../../prisma/index.js'
import { AuditLogService } from '../../../audit/audit-log.service.js'

import { buildTestEmailBody } from './email-test.body.js'
import { classifySend, type ProbeResult } from './email-test.outcome.js'
import { EMAIL_TEST_POLICY } from './email-test.policy.js'
import { EmailTestStore, integrationError } from './email-test.store.js'
import { lastToEvidence, toReceipt } from './email-test.view.js'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const STATUS: Partial<Record<IntegrationErrorCode, number>> = {
  [IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED]: 410,
  [IntegrationErrorCode.INTEGRATION_ATTEMPT_MISMATCH]: 409,
  [IntegrationErrorCode.INTEGRATION_RECIPIENT_CHANGED]: 409,
  [IntegrationErrorCode.INTEGRATION_CONFIG_CHANGED]: 409,
  [IntegrationErrorCode.INTEGRATION_PROBE_COOLDOWN]: 429,
  [IntegrationErrorCode.INTEGRATION_PROBE_LIMIT]: 429,
  [IntegrationErrorCode.INTEGRATION_PROBE_BUSY]: 429,
}

function mask(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 1 ? '***' : `${email.slice(0, 1)}***${email.slice(at)}`
}

/**
 * The operator email test. It proves one thing: the configured provider accepted a direct send
 * from this API server. Not the worker path, not invitation templates, not inbox delivery.
 */
@Injectable()
export class EmailTestProbe {
  constructor(
    private readonly store: EmailTestStore,
    private readonly env: EnvService,
    @Inject('EmailProvider') private readonly provider: EmailProvider,
    private readonly audit: AuditLogService,
    private readonly db: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(EmailTestProbe.name)
  }

  get mode(): 'resend' | 'mock' {
    return this.env.get('EMAIL_PROVIDER') === 'resend' ? 'resend' : 'mock'
  }

  /**
   * Binds saved evidence to the current settings. Kept only in Redis; never returned, logged,
   * audited or used as an identifier. Same technique as the queued-email scope witness.
   */
  witness(): string {
    return sha256(
      JSON.stringify({
        provider: this.mode,
        credential: sha256(this.env.get('RESEND_API_KEY') ?? ''),
        from: this.env.get('EMAIL_FROM'),
        recipeVersion: 1,
      })
    )
  }

  private mockInProduction(): boolean {
    return this.mode === 'mock' && this.env.get('NODE_ENV') === 'production'
  }

  private async operator(actorId: string): Promise<{ email: string; token: string } | null> {
    const user = await this.db.user.findUnique({
      where: { id: actorId },
      select: { email: true, emailVerified: true },
    })
    if (!user?.emailVerified) return null
    return {
      email: user.email,
      token: sha256(`${actorId}|${user.email.toLowerCase()}`).slice(0, 32),
    }
  }

  private async requireOperator(actorId: string): Promise<{ email: string; token: string }> {
    if (this.mockInProduction())
      throw integrationError(IntegrationErrorCode.INTEGRATION_MOCK_IN_PRODUCTION, 409)
    const operator = await this.operator(actorId)
    if (!operator) throw integrationError(IntegrationErrorCode.INTEGRATION_NO_VERIFIED_ADDRESS, 409)
    return operator
  }

  /** Issues the single-use attempt id shown with the confirmation. Nothing is sent. */
  async prepare(actorId: string): Promise<ProbePreparation> {
    const operator = await this.requireOperator(actorId)
    const issued = await this.store.prepare(
      actorId,
      randomBytes(16).toString('base64url'),
      operator.token,
      this.witness()
    )
    return {
      attemptId: issued.attemptId,
      recipientHint: mask(operator.email),
      expiresAt: new Date(issued.expiresAt).toISOString(),
    }
  }

  async run(actorId: string, attemptId: string): Promise<ProbeReceipt> {
    const operator = await this.requireOperator(actorId)
    const leaseToken = randomBytes(16).toString('base64url')
    const reserved = await this.store.reserve({
      attemptId,
      actorId,
      recipientToken: operator.token,
      scopeWitness: this.witness(),
      leaseToken,
      provider: this.mode,
    })
    if (reserved.kind === 'refused')
      throw integrationError(
        reserved.code,
        STATUS[reserved.code] ?? 409,
        reserved.retryAfterSeconds ? { retryAfterSeconds: reserved.retryAfterSeconds } : undefined
      )
    if (reserved.kind === 'replay')
      return toReceipt(attemptId, reserved.attempt, await this.store.now())

    await this.execute(actorId, attemptId, leaseToken, operator.email)
    return this.receipt(attemptId)
  }

  private async execute(
    actorId: string,
    attemptId: string,
    leaseToken: string,
    email: string
  ): Promise<void> {
    try {
      await this.audit.record(
        {
          action: 'integration.email_test_requested',
          actorType: AuditActorType.USER,
          actorId,
          targetType: AuditTargetType.USER,
          targetId: actorId,
          metadata: { provider: this.mode },
        },
        { failOpen: false }
      )
    } catch {
      await this.safeFail(attemptId, leaseToken, 'audit_failed')
      throw integrationError(IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE, 503)
    }
    // The monotonic reading precedes the command so a stalled reply is counted in the pause.
    const t0 = performance.now()
    let marked: boolean
    try {
      marked = await this.store.markSending(attemptId, leaseToken)
    } catch (error) {
      await this.safeFail(attemptId, leaseToken, 'redis_timeout')
      throw error
    }
    if (!marked) return this.safeFail(attemptId, leaseToken, 'lease_lost')
    if (performance.now() - t0 > EMAIL_TEST_POLICY.precheckMs)
      return this.safeFail(attemptId, leaseToken, 'precheck')

    const result = await this.send(email, attemptId, t0)
    try {
      await this.store.settle(attemptId, leaseToken, result.outcome, result.class ?? '')
    } catch {
      // The attempt stays `sending` and reads as unknown after its deadline.
      this.logger.warn(
        { event: 'integration.email_test.settle_failed' },
        'Test email settle failed'
      )
    }
    await this.audit.record({
      action: 'integration.email_test_settled',
      actorType: AuditActorType.USER,
      actorId,
      targetType: AuditTargetType.USER,
      targetId: actorId,
      metadata: { provider: this.mode, outcome: result.outcome, class: result.class ?? 'none' },
    })
  }

  private async safeFail(attemptId: string, leaseToken: string, code: string): Promise<void> {
    try {
      await this.store.failBeforeSend(attemptId, leaseToken, code)
    } catch {
      // A reserved attempt that cannot be closed reads as "did not start" after its limit.
    }
  }

  /** One logical deadline from `t0`; the physical call keeps its slot and its late result is fenced. */
  private send(email: string, attemptId: string, t0: number): Promise<ProbeResult> {
    const controller = new AbortController()
    const body = buildTestEmailBody(this.env.get('EMAIL_FROM'), email)
    const physical = this.provider
      .sendPrepared(body, `integration-test-${attemptId}`, controller.signal)
      .then(
        (result) => classifySend(this.mode, result),
        (): ProbeResult => ({ outcome: 'unknown', class: null })
      )
    const remaining = Math.max(0, EMAIL_TEST_POLICY.deadlineMs - (performance.now() - t0))
    return new Promise<ProbeResult>((resolve) => {
      const timer = setTimeout(() => {
        controller.abort()
        resolve({ outcome: 'unknown', class: 'deadline' })
      }, remaining)
      void physical.then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
    })
  }

  private async receipt(attemptId: string): Promise<ProbeReceipt> {
    const [attempt, now] = await Promise.all([this.store.readAttempt(attemptId), this.store.now()])
    if (!attempt) throw integrationError(IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE, 503)
    return toReceipt(attemptId, attempt, now)
  }

  /** Read-only recovery of the operator's own attempt. Never creates or resends. */
  async receiptFor(actorId: string, attemptId: string): Promise<ProbeReceipt> {
    const [attempt, now] = await Promise.all([this.store.readAttempt(attemptId), this.store.now()])
    if (!attempt || attempt.actorId !== actorId)
      throw new AppException(
        ResourceErrorCode.RESOURCE_NOT_FOUND,
        404,
        ResourceErrorCode.RESOURCE_NOT_FOUND
      )
    return toReceipt(attemptId, attempt, now)
  }

  async evidence(): Promise<IntegrationEvidence> {
    const [last, now] = await Promise.all([this.store.readLast(), this.store.now()])
    return lastToEvidence(last, this.witness(), now)
  }

  async action(actorId: string): Promise<IntegrationAction> {
    const operator = await this.operator(actorId)
    const [cooldownMs, busy, ownId] = await Promise.all([
      this.store.cooldownRemainingMs(actorId),
      this.store.leaseHeld(),
      this.store.readActorAttempt(actorId),
    ])
    const own = ownId ? await this.store.readAttempt(ownId) : null
    const reason: IntegrationAction['unavailableReason'] = this.mockInProduction()
      ? 'mock_in_production'
      : !operator
        ? 'no_verified_address'
        : cooldownMs > 0
          ? 'cooldown'
          : busy
            ? 'busy'
            : null
    return {
      probeId: 'email_test',
      kind: 'operator_email_test',
      available: reason === null,
      unavailableReason: reason,
      cooldownRemainingSeconds: Math.ceil(cooldownMs / 1000),
      ownAttemptId: own && own.actorId === actorId ? ownId : null,
    }
  }
}
