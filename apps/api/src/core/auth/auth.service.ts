import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditActorType, AuditTargetType } from '@prisma/client'
import * as argon2 from 'argon2'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import type {
  LoginInput,
  RegisterInput,
  RequestPrincipal,
  SupportedLocale,
  UpdateProfileInput,
  UserResponse,
} from '@amcore/shared'
import { AuthErrorCode, parseSupportedLocale } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { EmailService } from '../../infrastructure/email'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'
import { NotificationsService } from '../notifications/notifications.service'

import { EmailIdentityService } from './email-identity.service'
import { LoginRateLimiterService } from './login-rate-limiter.service'
import { SessionService } from './session.service'
import { TokenService } from './token.service'
import { TokenManagerService } from './token-manager.service'
import { UserCacheService } from './user-cache.service'

interface AuthResult {
  user: UserResponse
  accessToken: string
  refreshToken: string
}

interface RequestInfo {
  userAgent?: string
  ipAddress?: string
  /**
   * Locale negotiated from the request `Accept-Language` header (controller
   * resolves it via `req.acceptsLanguages`). Used at registration only as a
   * fallback when the body carries no explicit `locale`.
   */
  acceptedLocale?: SupportedLocale
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenManager: TokenManagerService,
    private readonly sessionService: SessionService,
    private readonly emailService: EmailService,
    private readonly userCacheService: UserCacheService,
    private readonly env: EnvService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly auditLog: AuditLogService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly loginRateLimiter: LoginRateLimiterService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AuthService.name)
  }

  /** Register new user */
  async register(input: RegisterInput, requestInfo: RequestInfo): Promise<AuthResult> {
    const email = this.emailIdentity.normalizeForStorage(input.email)
    const emailCanonical = this.emailIdentity.canonicalize(input.email)

    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { emailCanonical },
    })

    if (existing) {
      throw new AppException(
        'Email already exists',
        HttpStatus.CONFLICT,
        AuthErrorCode.EMAIL_ALREADY_EXISTS
      )
    }

    // Hash password
    const passwordHash = await argon2.hash(input.password)

    // Locale precedence: explicit body choice → negotiated `Accept-Language` →
    // omit so the Prisma `User.locale` default applies. An explicit user choice
    // must never be overridden by the header (MDN Accept-Language guidance).
    const locale = input.locale ?? requestInfo.acceptedLocale

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        emailCanonical,
        passwordHash,
        name: input.name,
        ...(locale ? { locale } : {}),
        lastLoginAt: new Date(),
      },
    })

    // Create the session first so the access token can carry its id as `sid`
    // (OB-06b / ADR-037 step-up freshness).
    const { session, refreshToken } = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      sid: session.id,
    })

    // Generate verification token synchronously so the row is committed
    // before HTTP 201 returns. Calling resendVerificationEmail here would
    // race with any immediately-following user action that creates a token
    // (its first step invalidates all existing user tokens), so we build
    // the URL in-band and only the email *send* stays non-blocking.
    const { token: verificationToken } = await this.tokenManager.generateEmailVerificationToken(
      user.id
    )
    const verificationUrl = `${this.env.get('FRONTEND_URL')}/verify-email?token=${verificationToken}`
    const expiresIn = `${this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS')} часов`

    // Queue welcome + verification emails (non-blocking, silent fail)
    void this.emailService
      .sendWelcomeEmail({
        name: user.name ?? user.email,
        email: user.email,
        locale: user.locale as 'ru' | 'en',
      })
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send welcome email'))
    void this.emailService
      .sendEmailVerificationEmail(user.email, {
        name: user.name ?? user.email,
        verificationUrl,
        expiresIn,
        locale: user.locale as 'ru' | 'en',
      })
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send verification email'))

    this.logger.info({ userId: user.id, email: user.email }, 'User registered successfully')

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    }
  }

  /** Login user */
  async login(input: LoginInput, requestInfo: RequestInfo): Promise<AuthResult> {
    const ip = requestInfo.ipAddress ?? ''
    const emailCanonical = this.emailIdentity.canonicalize(input.email)

    // Check brute-force limits before hitting DB
    await this.loginRateLimiter.check(emailCanonical, ip)

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { emailCanonical },
    })

    if (!user || !user.passwordHash) {
      await this.loginRateLimiter.consume(emailCanonical, ip)
      throw new AppException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS
      )
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, input.password)
    if (!valid) {
      await this.loginRateLimiter.consume(emailCanonical, ip)
      throw new AppException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS
      )
    }

    // Reset rate limit counters on successful login
    await this.loginRateLimiter.reset(emailCanonical, ip)

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Create the session first so the access token can carry its id as `sid`
    // (OB-06b / ADR-037 step-up freshness).
    const { session, refreshToken } = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      sid: session.id,
    })

    this.logger.info({ userId: user.id, email: user.email }, 'User logged in successfully')

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    }
  }

  /** Logout (invalidate refresh token) */
  async logout(refreshTokenHash: string): Promise<void> {
    await this.sessionService.deleteByRefreshToken(refreshTokenHash)
    this.logger.info('User logged out successfully')
  }

  /**
   * Step-up re-authentication (OB-06b / ADR-037).
   *
   * Verifies the caller's password and refreshes ONLY the current session's
   * recent-auth window (`Session.lastAuthAt`). It never creates a session or
   * rotates the refresh token. Returns a fresh access token carrying the same
   * `sid`. All "must re-login" outcomes use `403 STEP_UP_REQUIRED`; a wrong
   * password is `401 INVALID_CREDENTIALS`; a password-less (OAuth-only) account
   * is `403 STEP_UP_METHOD_UNAVAILABLE`. Shares the login brute-force limiter
   * (per canonical email + IP), so the controller threads `req.ip`.
   */
  async stepUp(
    principal: RequestPrincipal,
    password: string,
    ip: string
  ): Promise<{ accessToken: string }> {
    const sid = principal.sid
    if (!sid) {
      await this.recordStepUp(principal.sub, sid, 'auth.step_up_failed', 'no_session')
      // Legacy token without a session id — cannot identify the session to bump.
      throw this.stepUpRequired()
    }

    // Prove the session is live BEFORE any password work, so a stolen but
    // already-revoked/expired access token cannot be used as a password oracle.
    // This precedes the password-less check too: a no-session OAuth-only token
    // gets STEP_UP_REQUIRED, not STEP_UP_METHOD_UNAVAILABLE.
    const live = await this.sessionService.hasLiveSession(sid, principal.sub)
    if (!live) {
      await this.recordStepUp(principal.sub, sid, 'auth.step_up_failed', 'no_session')
      this.logger.warn(
        { event: 'auth.step_up.failed', userId: principal.sub, reason: 'no_session' },
        'Step-up failed: current session not live'
      )
      throw this.stepUpRequired()
    }

    const user = await this.prisma.user.findUnique({ where: { id: principal.sub } })
    if (!user) {
      await this.recordStepUp(principal.sub, sid, 'auth.step_up_failed', 'no_session')
      throw this.stepUpRequired()
    }

    // OAuth-only accounts have no password; factor-based step-up is future MFA.
    if (!user.passwordHash) {
      await this.recordStepUp(user.id, sid, 'auth.step_up_failed', 'method_unavailable')
      this.logger.warn(
        { event: 'auth.step_up.failed', userId: user.id, reason: 'method_unavailable' },
        'Step-up unavailable: account has no password'
      )
      throw new AppException(
        'Password step-up is not available for this account',
        HttpStatus.FORBIDDEN,
        AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE
      )
    }

    // Reuse the login brute-force limiter so step-up is not a password oracle.
    await this.loginRateLimiter.check(user.emailCanonical, ip)

    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      await this.loginRateLimiter.consume(user.emailCanonical, ip)
      await this.recordStepUp(user.id, sid, 'auth.step_up_failed', 'invalid_password')
      this.logger.warn(
        { event: 'auth.step_up.failed', userId: user.id, reason: 'invalid_password' },
        'Step-up failed: invalid password'
      )
      throw new AppException(
        'Invalid password',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS
      )
    }

    await this.loginRateLimiter.reset(user.emailCanonical, ip)

    // Bump only the current live session. count 0 → session gone (revoked by a
    // Stage 1 role change, logged out, expired) → must re-login.
    const touched = await this.sessionService.touchLastAuth(sid, user.id)
    if (touched === 0) {
      await this.recordStepUp(user.id, sid, 'auth.step_up_failed', 'no_session')
      this.logger.warn(
        { event: 'auth.step_up.failed', userId: user.id, reason: 'no_session' },
        'Step-up failed: current session not found'
      )
      throw this.stepUpRequired()
    }

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      sid,
    })

    await this.recordStepUp(user.id, sid, 'auth.step_up_succeeded')

    this.logger.info(
      { event: 'auth.step_up.succeeded', userId: user.id, sessionId: sid },
      'Step-up succeeded'
    )

    return { accessToken }
  }

  private stepUpRequired(): AppException {
    return new AppException(
      'Step-up authentication required',
      HttpStatus.FORBIDDEN,
      AuthErrorCode.STEP_UP_REQUIRED
    )
  }

  private async recordStepUp(
    actorId: string,
    sessionId: string | undefined,
    action: 'auth.step_up_failed' | 'auth.step_up_succeeded',
    reason?: string
  ): Promise<void> {
    await this.auditLog.record({
      action,
      actorId,
      actorType: AuditActorType.USER,
      metadata:
        action === 'auth.step_up_failed'
          ? { pinoEvent: 'auth.step_up.failed', reason }
          : { pinoEvent: 'auth.step_up.succeeded', sessionId },
      targetId: sessionId ?? null,
      targetType: AuditTargetType.SESSION,
    })
  }

  /** Get user by ID */
  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    return user ? this.mapUserToResponse(user) : null
  }

  /**
   * Partial profile update (`PATCH /auth/me`). Only the supplied fields are
   * written; an absent field is left untouched. Invalidates the user cache so a
   * subsequent authenticated request observes the change, then returns the
   * canonical profile response.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserResponse> {
    const data: { name?: string; locale?: SupportedLocale; timezone?: string } = {}
    if (input.name !== undefined) data.name = input.name
    if (input.locale !== undefined) data.locale = input.locale
    if (input.timezone !== undefined) data.timezone = input.timezone

    const user = await this.prisma.user.update({ where: { id: userId }, data })
    await this.userCacheService.invalidateUser(userId)

    this.logger.info({ userId, fields: Object.keys(data) }, 'User profile updated')

    return this.mapUserToResponse(user)
  }

  /** Send password reset email (silent fail for unknown emails) */
  async forgotPassword(email: string): Promise<void> {
    const emailCanonical = this.emailIdentity.canonicalize(email)
    await this.checkRateLimit(`forgot:${emailCanonical}`, 3)

    const user = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (!user) return // Silent fail — prevent email enumeration

    const { token } = await this.tokenManager.generatePasswordResetToken(user.id)

    const resetUrl = `${this.env.get('FRONTEND_URL')}/reset-password?token=${token}`
    const expiresIn = `${this.env.get('PASSWORD_RESET_EXPIRY_MINUTES')} минут`

    // Best-effort: secret-bearing emails are sent directly (EQS-02) and
    // `sendNow` throws on provider failure. Swallow it here — letting a 500
    // surface for a known email while unknown emails return 200 would be an
    // account-enumeration oracle on this recovery endpoint. Never log the
    // reset URL/token — only the provider error message.
    try {
      await this.emailService.sendPasswordResetEmail(user.email, {
        name: user.name ?? user.email,
        resetUrl,
        expiresIn,
        locale: user.locale as 'ru' | 'en',
      })
      this.logger.info({ userId: user.id }, 'Password reset email sent')
    } catch (err) {
      this.logger.warn(
        { userId: user.id, err: err instanceof Error ? err.message : 'unknown' },
        'Failed to send password reset email'
      )
    }
  }

  /** Reset password using token */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const {
      id: resetTokenId,
      userId,
      tokenHash,
    } = await this.tokenManager.verifyPasswordResetToken(token)

    const passwordHash = await argon2.hash(newPassword)
    const changedAt = new Date()

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { tokenHash },
        data: { used: true, usedAt: changedAt },
      })

      await tx.user.update({
        where: { id: userId },
        // Promote emailVerified: the reset token was delivered to and returned from
        // the account email, proving control of that mailbox (OWASP Forgot Password /
        // NIST 800-63B). This is done in the reset transaction so the verified-only
        // notification-email resolver materializes the password-changed alert below
        // even for a previously unverified account.
        data: { passwordHash, emailVerified: true },
      })
    })

    await this.sessionService.deleteAllByUserId(userId)
    await this.userCacheService.invalidateUser(userId)

    // Security alert via the durable notifications subsystem (ADR-052): in-app + email,
    // both mandatory (the user cannot silence a password-change alert). Emitted AFTER
    // the reset commit via notify() — its own transaction + immediate best-effort
    // dispatch wake — so a notification write can never roll back the committed reset,
    // and the resolver reads the just-committed emailVerified=true. The idempotency key
    // is the consumed reset-token id (one alert per reset, retry-safe; not a secret).
    // Best-effort: a notifications-subsystem hiccup must not 500 an already-committed
    // reset — the recovery poller still drains any committed pending email delivery.
    try {
      await this.notifications.notify({
        recipientUserId: userId,
        type: 'account.password_changed',
        payload: { changedAt: changedAt.toISOString() },
        idempotencyKey: `account.password_changed:${resetTokenId}`,
      })
    } catch (err) {
      this.logger.warn(
        { userId, err: err instanceof Error ? err.message : 'unknown' },
        'Failed to emit password-changed notification'
      )
    }

    this.logger.info({ userId }, 'Password reset successfully')
  }

  /** Verify email address using token */
  async verifyEmail(token: string): Promise<void> {
    const { userId, tokenHash } = await this.tokenManager.verifyEmailVerificationToken(token)

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { tokenHash },
        data: { used: true, usedAt: new Date() },
      })

      await tx.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      })
    })

    await this.userCacheService.invalidateUser(userId)

    this.logger.info({ userId }, 'Email verified successfully')
  }

  /** Resend verification email (silent fail if already verified) */
  async resendVerificationEmail(email: string): Promise<void> {
    const emailCanonical = this.emailIdentity.canonicalize(email)
    await this.checkRateLimit(`resend-verification:${emailCanonical}`, 3)

    const user = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (!user || user.emailVerified) return // Silent fail

    const { token } = await this.tokenManager.generateEmailVerificationToken(user.id)

    const verificationUrl = `${this.env.get('FRONTEND_URL')}/verify-email?token=${token}`
    const expiresIn = `${this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS')} часов`

    // Best-effort, same enumeration rationale as forgotPassword: a direct-send
    // failure (EQS-02 `sendNow` throws) must not turn into a 500 that reveals
    // the account exists and is unverified. Never log the verification token.
    try {
      await this.emailService.sendEmailVerificationEmail(user.email, {
        name: user.name ?? user.email,
        verificationUrl,
        expiresIn,
        locale: user.locale as 'ru' | 'en',
      })
      this.logger.info({ userId: user.id }, 'Verification email sent')
    } catch (err) {
      this.logger.warn(
        { userId: user.id, err: err instanceof Error ? err.message : 'unknown' },
        'Failed to send verification email'
      )
    }
  }

  /** Rate limit by key: max N requests per hour */
  private async checkRateLimit(key: string, max: number): Promise<void> {
    const cacheKey = `rate:${key}`
    const count = ((await this.cache.get<number>(cacheKey)) ?? 0) + 1

    if (count > max) {
      throw new AppException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED
      )
    }

    await this.cache.set(cacheKey, count, 3600 * 1000) // 1 hour TTL in ms
  }

  /** Map Prisma user to API response */
  private mapUserToResponse(user: {
    id: string
    email: string
    emailVerified: boolean
    name: string | null
    avatarUrl: string | null
    phone: string | null
    locale: string
    timezone: string
    createdAt: Date
    lastLoginAt: Date | null
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      locale: parseSupportedLocale(user.locale),
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
