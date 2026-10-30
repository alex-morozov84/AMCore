import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import { AuthErrorCode, type RequestPrincipal, type StepUpResponse } from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import { AuditActorType, AuditTargetType, type Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import { AuditLogService } from '../audit/index.js'

import { LoginRateLimiterService } from './login-rate-limiter.service.js'
import { issueFamilyAccessToken } from './mfa/mfa-access-issuance.js'
import { requireMfaAdmission } from './mfa/mfa-admission-result.js'
import { MfaAuthorityReader } from './mfa/mfa-authority-reader.service.js'
import { requiredPrimaryProofs } from './mfa/mfa-policy.js'
import { mfaDatabaseClock } from './mfa/mfa-transaction.js'
import {
  capturePasswordStepUp,
  lockPasswordStepUp,
  passwordStepUpRequired,
  type PasswordStepUpSnapshot,
  type PasswordStepUpSource,
  samePasswordSnapshot,
} from './password-step-up-authority.js'
import { TokenService } from './token.service.js'

/** Legacy password entry verifies only primary evidence; missing MFA returns no credentials. */
@Injectable()
export class PasswordStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: LoginRateLimiterService,
    private readonly tokens: TokenService,
    private readonly audit: AuditLogService,
    private readonly env: EnvService
  ) {}

  async verify(principal: RequestPrincipal, password: string, ip: string): Promise<StepUpResponse> {
    const source = capturePasswordStepUp(principal)
    try {
      const before = await this.prisma.$transaction((tx) => lockPasswordStepUp(tx, source), {
        maxWait: 2000,
        timeout: 4000,
      })
      if (!before.user.passwordHash)
        throw new AppException(
          'Password step-up is not available for this account',
          403,
          AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE
        )
      await this.limiter.check(before.user.emailCanonical, ip)
      if (!(await argon2.verify(before.user.passwordHash, password))) {
        await this.limiter.consume(before.user.emailCanonical, ip)
        throw new AppException('Invalid password', 401, AuthErrorCode.INVALID_CREDENTIALS)
      }
      await this.limiter.reset(before.user.emailCanonical, ip)
      return await this.prisma.$transaction((tx) => this.commit(tx, source, before), {
        maxWait: 2000,
        timeout: 4000,
      })
    } catch (error) {
      await this.recordFailure(source, error)
      throw error
    }
  }

  private async commit(
    tx: Prisma.TransactionClient,
    source: PasswordStepUpSource,
    before: PasswordStepUpSnapshot
  ): Promise<StepUpResponse> {
    const current = await lockPasswordStepUp(tx, source)
    if (!samePasswordSnapshot(before, current)) throw passwordStepUpRequired(source)
    const eventId = randomUUID()
    await this.commitPrimary(tx, source, current, before.at, eventId)
    const window = this.env.get('STEP_UP_MAX_AGE_SECONDS')
    const admission = requireMfaAdmission(
      await new MfaAuthorityReader(tx).readForSensitiveAction(
        { ...source.principal, email: source.principal.email ?? '' },
        source.browser,
        window
      )
    )
    const requiredProofs =
      admission.requiredProofs ??
      requiredPrimaryProofs(
        { primaryAt: before.at, primaryProofId: eventId },
        await mfaDatabaseClock(tx),
        window
      )
    if (requiredProofs.length) return { kind: 'proof_required', requiredProofs }
    const { principal } = source
    return {
      accessToken: await issueFamilyAccessToken(tx, this.tokens, {
        sub: current.user.id,
        email: current.user.email,
        systemRole: current.user.systemRole,
        sid: principal.sid,
        ...(current.family && { fid: current.family.id, securityVersion: current.version }),
        ...(principal.browserBound && { browserBound: true as const }),
        ...(principal.organizationId !== undefined && {
          organizationId: principal.organizationId,
          aclVersion: principal.aclVersion,
        }),
      }),
    }
  }

  private async commitPrimary(
    tx: Prisma.TransactionClient,
    source: PasswordStepUpSource,
    current: PasswordStepUpSnapshot,
    at: Date,
    eventId: string
  ): Promise<void> {
    const { family, user } = current
    const keepNewer =
      family?.primaryMethod === 'password' &&
      family.primaryProofId &&
      family.primaryAt &&
      family.primaryAt >= at &&
      family.primaryAt <= current.at
    const primaryAt = keepNewer ? family.primaryAt! : at
    if (family && !keepNewer)
      await tx.authSessionFamily.update({
        where: { id: family.id },
        data: {
          primaryMethod: 'password',
          primaryAt,
          primaryProofId: eventId,
        },
      })
    const touched = await tx.session.updateMany({
      where: {
        userId: user.id,
        ...(family ? { familyId: family.id } : { id: source.principal.sid }),
        revokedAt: null,
        expiresAt: { gt: current.at },
      },
      data: { lastAuthAt: primaryAt },
    })
    if (!family && !touched.count) throw passwordStepUpRequired(source)
    await this.audit.record(
      {
        action: family ? 'auth.mfa_proof_verified' : 'auth.step_up_succeeded',
        actorType: AuditActorType.USER,
        actorId: user.id,
        targetType: AuditTargetType.SESSION,
        targetId: family?.id ?? source.principal.sid,
        metadata: family
          ? { operationId: eventId, method: 'password' }
          : { pinoEvent: 'auth.step_up.succeeded', sessionId: source.principal.sid },
      },
      { tx }
    )
  }

  private async recordFailure(source: PasswordStepUpSource, error: unknown): Promise<void> {
    if (!(error instanceof AppException)) return
    const reasons: Record<string, string> = {
      [AuthErrorCode.INVALID_CREDENTIALS]: 'invalid_password',
      [AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE]: 'method_unavailable',
      [AuthErrorCode.STEP_UP_REQUIRED]: 'no_session',
      [AuthErrorCode.SESSION_CHANGED]: 'no_session',
    }
    const reason = reasons[error.errorCode ?? '']
    if (!reason) return
    await this.audit.record({
      action: 'auth.step_up_failed',
      actorType: AuditActorType.USER,
      actorId: source.principal.sub,
      targetType: AuditTargetType.SESSION,
      targetId: source.principal.sid ?? null,
      metadata: { pinoEvent: 'auth.step_up.failed', reason },
    })
  }
}
