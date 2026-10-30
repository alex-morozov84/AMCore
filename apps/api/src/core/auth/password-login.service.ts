import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  AuthErrorCode,
  type LoginInput,
  type PasswordLoginPending,
  type PasswordLoginResponse,
} from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../common/exceptions/index.js'

import { AuthService } from './auth.service.js'
import type { FamilyIssuance } from './mfa/mfa-family-issuance.service.js'
import { MfaFamilyIssuanceService } from './mfa/mfa-family-issuance.service.js'
import type { FlowRequest } from './mfa/mfa-flow-lock.js'
import type { InvitationLoginScope, StoredInvitationIntent } from './mfa/mfa-invitation-intent.js'
import type {
  LoginFrame,
  LoginStart,
  OAuthIdentitySnapshot,
} from './mfa/mfa-login-start.service.js'
import { MfaLoginStartService } from './mfa/mfa-login-start.service.js'
import { TokenService } from './token.service.js'

export type PasswordLoginResult =
  | { kind: 'pending'; body: PasswordLoginPending }
  | { kind: 'complete'; body: PasswordLoginResponse; refreshToken: string }
interface LoginMetadata {
  source: string
  invited?: InvitationLoginScope
  frame: LoginFrame
  userAgent?: string
  ipAddress?: string
}
type CompletedLogin = Extract<PasswordLoginResult, { kind: 'complete' }>
export type LoginCompletion = CompletedLogin | Exclude<FamilyIssuance, { kind: 'credentials' }>

/** The real password route uses the same durable proofs and issuance as MFA continuation commands. */
@Injectable()
export class PasswordLoginService {
  constructor(
    private readonly starts: MfaLoginStartService,
    private readonly issuance: MfaFamilyIssuanceService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService
  ) {}

  async begin(input: LoginInput, metadata: LoginMetadata): Promise<PasswordLoginResult> {
    const start = await this.starts.password(
      input.email,
      input.password,
      metadata.source,
      metadata.frame,
      randomUUID(),
      metadata.invited
    )
    return this.finishStart(start, metadata)
  }

  async beginOAuth(
    identity: OAuthIdentitySnapshot,
    metadata: LoginMetadata,
    invitation?: StoredInvitationIntent
  ): Promise<PasswordLoginResult> {
    const start = await this.starts.oauth(
      identity,
      metadata.source,
      metadata.frame,
      randomUUID(),
      invitation
    )
    const result = await this.finishStart(start, metadata)
    if (result.kind === 'pending') {
      const [name, domain] = identity.emailCanonical.split('@')
      result.body.accountLabel = `${name?.slice(0, 2) ?? ''}...@${domain ?? ''}`
    }
    return result
  }

  private async finishStart(
    start: LoginStart,
    metadata: LoginMetadata
  ): Promise<PasswordLoginResult> {
    if (start.kind === 'invalid_credentials')
      throw new AppException('Invalid email or password', 401, AuthErrorCode.INVALID_CREDENTIALS)
    if (start.kind === 'unavailable') throw new ServiceUnavailableException('MFA unavailable')
    if (start.kind === 'limited')
      throw new AppException('Too many MFA starts', 429, AuthErrorCode.RATE_LIMIT_EXCEEDED, {
        retryAfterSeconds: start.retryAfter,
      })
    if (!('request' in start)) throw changed()
    // A browser first retains this capability and its own completion operation.
    // Losing this response can leave only an expiring reservation, never lost session credentials.
    if (start.kind !== 'ordinary' || metadata.frame.kind === 'browser')
      return { kind: 'pending', body: pending(start) }
    const operationId = randomUUID()
    const issued = await this.complete(start.request, operationId, {
      ...metadata,
      vaultBinding: null,
    })
    if (issued.kind === 'unavailable') throw new ServiceUnavailableException('MFA unavailable')
    if (issued.kind !== 'complete') throw changed()
    return issued
  }

  async complete(
    request: FlowRequest,
    operationId: string,
    metadata: Pick<LoginMetadata, 'userAgent' | 'ipAddress'> & { vaultBinding: string | null }
  ): Promise<LoginCompletion> {
    const issued = await this.issuance.complete(request, operationId, metadata)
    if (issued.kind !== 'credentials') return issued
    const claims = this.tokens.verifyAccessToken(issued.accessToken)
    const user = await this.auth.getUserById(claims.sub)
    if (!user) throw changed()
    const browser = issued.publication.browser
    return {
      kind: 'complete',
      refreshToken: issued.refreshToken,
      body: {
        user,
        accessToken: issued.accessToken,
        ...((browser || issued.receipt) && {
          publication: {
            continuation: request.credential,
            operationId,
            receipt: issued.receipt,
            familyId: issued.publication.familyId,
            securityVersion: issued.publication.securityVersion,
            browser: browser
              ? {
                  contextId: browser.contextId,
                  generation: browser.generation,
                  audience: browser.audience,
                }
              : null,
          },
        }),
      },
    }
  }
}

function pending(start: Extract<LoginStart, { request: unknown }>): PasswordLoginPending {
  return {
    kind: 'mfa',
    continuation: start.request.credential,
    purpose: start.request.purpose,
    state:
      start.kind === 'ordinary'
        ? 'ready'
        : start.passwordRequired
          ? 'password_required'
          : start.setupRequired
            ? 'enrollment_required'
            : 'verify_required',
    nextAction:
      start.kind === 'ordinary'
        ? 'complete'
        : start.kind === 'recovery_ticket_required'
          ? 'recovery_ticket'
          : start.setupRequired
            ? 'enroll'
            : 'verify',
    expiresAt: start.expiresAt.toISOString(),
    requiredProofs: start.passwordRequired
      ? ['password', ...(start.setupRequired ? [] : ['second_factor' as const])]
      : start.setupRequired || start.kind === 'ordinary'
        ? []
        : ['second_factor'],
    remainingCodes: start.remainingCodes,
    generation: start.codeGeneration,
    browser: start.request.browser
      ? {
          contextId: start.request.browser.contextId,
          generation: start.request.browser.generation,
        }
      : null,
  }
}

function changed(): AppException {
  return new AppException(
    'Sign-in attempt changed; restart explicitly',
    401,
    AuthErrorCode.AUTH_CONTEXT_CHANGED
  )
}
