import { randomUUID } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'
import { PinoLogger } from 'nestjs-pino'

import type {
  InvitedRegisterInput,
  LoginPublication,
  RegisterInput,
  RequestPrincipal,
  StepUpResponse,
  SupportedLocale,
  UpdateProfileInput,
  UserResponse,
} from '@amcore/shared'
import { frontendAuthPath } from '@amcore/shared'
import {
  AuthErrorCode,
  coerceSupportedLocale,
  localizedFrontendUrl,
  parseSupportedLocale,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import type { User } from '../../generated/prisma/client.js'
import { EmailService } from '../../infrastructure/email/index.js'
import { StorageService } from '../../infrastructure/storage/index.js'
import { PrismaService } from '../../prisma/index.js'
import {
  type BrowserFrontendContext,
  resolveFrontendPlacement,
} from '../frontend-context/frontend-placement.js'
import { assertTokenFrontend } from '../frontend-context/frontend-token.js'
import {
  type InvitationHandoffProof,
  lockInvitationAuthAttempt,
} from '../invitations/invitation-auth-handoff.js'
import { InvitationContinuationService } from '../invitations/invitation-continuation.service.js'
import { invitationCredentialHint } from '../invitations/invitation-credential.js'
import {
  invalidInvitation,
  invitationClock,
  lockInvitationSignupEmail,
} from '../invitations/invitation-locks.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { isCanonicalEmailConflict } from '../organizations/establishment-error.js'

import { AuthMailLimiter } from './auth-mail-limiter.service.js'
import { lockAuthMailTokens } from './auth-mail-token-lock.js'
import { avatarUrlOf } from './avatar-url.js'
import { EmailIdentityService } from './email-identity.service.js'
import { LoginRateLimiterService } from './login-rate-limiter.service.js'
import { advanceAccountSecurity } from './mfa/mfa-invalidation.js'
import { captureInvitationLogin } from './mfa/mfa-invitation-intent.js'
import {
  lockRegistrationBrowser,
  type RegistrationBrowserIntent,
  writeRegistrationPublication,
} from './mfa/mfa-registration-publication.js'
import { lockMfaAccounts } from './mfa/mfa-transaction.js'
import { PasswordStepUpService } from './password-step-up.service.js'
import { prepareRegistrationMail, type RegistrationMail } from './registration-mail.js'
import { SessionService } from './session.service.js'
import { TokenService } from './token.service.js'
import { TokenManagerService } from './token-manager.service.js'

/** Only the canonical-email unique index means "already registered"; other violations stay errors. */
function rethrowEmailConflict(error: unknown): never {
  if (isCanonicalEmailConflict(error))
    throw new AppException(
      'Email already exists',
      HttpStatus.CONFLICT,
      AuthErrorCode.EMAIL_ALREADY_EXISTS
    )
  throw error
}

/** What a registration transaction returns: everything the response and the emails need. */
interface CommittedRegistration {
  user: User
  accessToken: string
  refreshToken: string
  mail: RegistrationMail
  publication?: LoginPublication
}

export interface AuthResult {
  publication?: LoginPublication
  user: UserResponse
  accessToken: string
  refreshToken: string
}

export interface RequestInfo {
  registrationBrowser?: RegistrationBrowserIntent
  frontend?: BrowserFrontendContext
  handoff?: InvitationHandoffProof
  invitationCredential?: string
  userAgent?: string
  ipAddress?: string
  /**
   * Locale negotiated from the request `Accept-Language` header (controller
   * resolves it via `negotiateLocale` and the accepts parser). Used at registration only as a
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
    private readonly authMailLimiter: AuthMailLimiter,
    private readonly sessionService: SessionService,
    private readonly emailService: EmailService,
    private readonly env: EnvService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly loginRateLimiter: LoginRateLimiterService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
    private readonly invitation: InvitationContinuationService,
    private readonly storage: StorageService,
    private readonly passwordStepUp: PasswordStepUpService
  ) {
    this.logger.setContext(AuthService.name)
  }

  /** Register new user */
  async register(input: RegisterInput, requestInfo: RequestInfo): Promise<AuthResult> {
    if (requestInfo.handoff) {
      const credential = requestInfo.invitationCredential ?? ''
      const { email } = await this.invitation.context(credential)
      if (this.emailIdentity.canonicalize(input.email) !== this.emailIdentity.canonicalize(email))
        throw invalidInvitation()
      return this.registerInvited(
        { password: input.password, name: input.name, locale: input.locale },
        credential,
        requestInfo
      )
    }
    if (requestInfo.frontend?.frontend === 'admin' || !this.env.get('AUTH_PUBLIC_SIGNUP_ENABLED'))
      throw new AppException('Public signup is disabled', 403, AuthErrorCode.PUBLIC_SIGNUP_DISABLED)
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

    const registrationUserId = randomUUID()
    // User, session and verification token commit together; if the transaction fails, its writes
    // roll back. Hashing above and mail below stay outside it; nothing inside waits on Redis, a
    // provider or another HTTP call.
    const created = await this.prisma
      .$transaction(
        async (tx) => {
          const locked = await lockRegistrationBrowser(
            tx,
            requestInfo.registrationBrowser,
            registrationUserId
          )
          const user = await tx.user.create({
            data: {
              ...(requestInfo.registrationBrowser ? { id: registrationUserId } : {}),
              email,
              emailCanonical,
              passwordHash,
              name: input.name,
              ...(locale ? { locale } : {}),
              lastLoginAt: requestInfo.registrationBrowser ? null : new Date(),
            },
          })
          // Create the session first so the access token can carry its id as `sid`
          // (OB-06b / ADR-037 step-up freshness).
          const coordinated =
            locked && requestInfo.registrationBrowser
              ? await writeRegistrationPublication(tx, this.tokenService, {
                  user,
                  locked,
                  intent: requestInfo.registrationBrowser,
                  userAgent: requestInfo.userAgent,
                  ipAddress: requestInfo.ipAddress,
                })
              : undefined
          const legacy = coordinated
            ? undefined
            : await this.sessionService.createSession(
                {
                  userId: user.id,
                  userAgent: requestInfo.userAgent,
                  ipAddress: requestInfo.ipAddress,
                },
                tx
              )
          const verification = await this.tokenManager.generateEmailVerificationToken(
            user.id,
            requestInfo.frontend,
            tx
          )
          return this.finishRegistration(
            user,
            coordinated ? coordinated.sessionId : legacy!.session.id,
            coordinated?.refreshToken ?? legacy!.refreshToken,
            verification.token,
            requestInfo,
            coordinated
          )
        },
        { maxWait: 2000, timeout: 4000 }
      )
      .catch(rethrowEmailConflict)
    this.dispatchRegistrationMail(created.user.id, created.mail)
    return {
      user: this.mapUserToResponse(created.user),
      accessToken: created.accessToken,
      refreshToken: created.refreshToken,
      ...(created.publication ? { publication: created.publication } : {}),
    }
  }

  /** Pure CPU/env work done before commit, so a failure here rolls the account back. */
  private finishRegistration(
    user: User,
    sessionId: string,
    refreshToken: string,
    verificationToken: string,
    requestInfo: RequestInfo,
    coordinated?: { accessToken: string; publication: LoginPublication }
  ): CommittedRegistration {
    const accessToken =
      coordinated?.accessToken ??
      this.tokenService.generateAccessToken({
        sub: user.id,
        email: user.email,
        systemRole: user.systemRole,
        sid: sessionId,
      })
    const mail = prepareRegistrationMail(this.env, user, verificationToken, requestInfo.frontend)
    return {
      user,
      accessToken,
      refreshToken,
      mail,
      ...(coordinated ? { publication: coordinated.publication } : {}),
    }
  }

  /** Scoped signup never accepts an editable email or creates organization access. */
  async registerInvited(
    input: InvitedRegisterInput,
    credential: string,
    requestInfo: RequestInfo
  ): Promise<AuthResult> {
    // Password work stays outside the bounded, generation-checked transaction.
    const passwordHash = await argon2.hash(input.password)
    const registrationUserId = randomUUID()
    const created = await this.prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
          if (requestInfo.handoff) await lockInvitationAuthAttempt(tx, requestInfo.handoff)
          const hint = await invitationCredentialHint(tx, { continuation: credential })
          assertTokenFrontend(hint.invite, requestInfo.frontend)
          await lockInvitationSignupEmail(tx, hint.invite.emailCanonical)
          const locked = await lockRegistrationBrowser(
            tx,
            requestInfo.registrationBrowser,
            registrationUserId
          )
          const { invite, expiresAt } = await this.invitation.lockValid(tx, {
            continuation: credential,
          })
          const existing = await tx.user.findUnique({
            where: { emailCanonical: invite.emailCanonical },
            select: { id: true },
          })
          if (existing)
            throw new AppException('Email already exists', 409, AuthErrorCode.EMAIL_ALREADY_EXISTS)
          const locale = input.locale ?? requestInfo.acceptedLocale
          const user = await tx.user.create({
            data: {
              ...(requestInfo.registrationBrowser ? { id: registrationUserId } : {}),
              email: invite.email,
              emailCanonical: invite.emailCanonical,
              passwordHash,
              name: input.name,
              ...(locale ? { locale } : {}),
              lastLoginAt: requestInfo.registrationBrowser ? null : new Date(),
            },
          })
          if (locked && !requestInfo.handoff) throw invalidInvitation()
          const intent =
            locked && requestInfo.handoff
              ? await captureInvitationLogin(
                  tx,
                  { credential, handoff: requestInfo.handoff, frontend: requestInfo.frontend },
                  user.emailCanonical
                )
              : undefined
          const coordinated =
            locked && requestInfo.registrationBrowser
              ? await writeRegistrationPublication(tx, this.tokenService, {
                  user,
                  locked,
                  intent: requestInfo.registrationBrowser,
                  invitation: intent,
                  userAgent: requestInfo.userAgent,
                  ipAddress: requestInfo.ipAddress,
                })
              : undefined
          const session = coordinated
            ? undefined
            : await this.sessionService.createSession(
                {
                  userId: user.id,
                  userAgent: requestInfo.userAgent,
                  ipAddress: requestInfo.ipAddress,
                  handoff: requestInfo.handoff,
                },
                tx
              )
          // Token issuance sets `lock_timeout` to 1000ms for waits after this point; the
          // transaction timeout still bounds everything. Keep the expiry check LAST so no
          // wait added above can move past expiry after the check.
          const verification = await this.tokenManager.generateEmailVerificationToken(
            user.id,
            requestInfo.frontend,
            tx
          )
          const finished = this.finishRegistration(
            user,
            coordinated ? coordinated.sessionId : session!.session.id,
            coordinated?.refreshToken ?? session!.refreshToken,
            verification.token,
            requestInfo,
            coordinated
          )
          if (expiresAt <= (await invitationClock(tx))) throw invalidInvitation()
          return finished
        },
        { maxWait: 2000, timeout: 4000 }
      )
      .catch(rethrowEmailConflict)
    this.dispatchRegistrationMail(created.user.id, created.mail)
    return {
      user: this.mapUserToResponse(created.user),
      accessToken: created.accessToken,
      refreshToken: created.refreshToken,
      ...(created.publication ? { publication: created.publication } : {}),
    }
  }

  /**
   * Starts both registration emails after the account has committed. The welcome greeting is
   * QUEUED (BullMQ/Redis) and best-effort: it is lost if the queue refuses it or the process
   * stops before queueing, and it has no resend. The verification email is sent directly and
   * can be resent. A failure here never reverses the signup.
   */
  private dispatchRegistrationMail(userId: string, mail: RegistrationMail): void {
    void this.emailService
      .sendWelcomeEmail(mail.welcome, userId)
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send welcome email'))
    void this.emailService
      .sendEmailVerificationEmail(mail.welcome.email, mail.verification)
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send verification email'))
  }

  /** Logout (invalidate refresh token) */
  async logout(refreshTokenHash: string): Promise<void> {
    await this.sessionService.deleteByRefreshToken(refreshTokenHash)
    this.logger.info('User logged out successfully')
  }

  /** Password entry can refresh only primary evidence of the same admitted session family. */
  async stepUp(principal: RequestPrincipal, password: string, ip: string): Promise<StepUpResponse> {
    return this.passwordStepUp.verify(principal, password, ip)
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

    // Read before write so the alert below can tell "field was in the request" apart
    // from "field's value actually changed" (a no-op PATCH — e.g. re-submitting the
    // current name — must not notify).
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const user = await this.prisma.user.update({ where: { id: userId }, data })

    this.logger.info({ userId, fields: Object.keys(data) }, 'User profile updated')

    const updatedFields = (Object.keys(data) as Array<keyof typeof data>).filter(
      (field) => user[field] !== previous[field]
    )

    if (updatedFields.length > 0) {
      // Informational, non-security in-app alert via the durable subsystem (ADR-052) —
      // mirrors resetPassword's account.password_changed emission below, but best-effort
      // only (not mandatory/multi-channel): a notifications hiccup must not fail an
      // already-committed profile update. Idempotency key uses a generated occurrence id,
      // not `user.updatedAt` — that column is TIMESTAMP(3) (millisecond precision), so two
      // real edits landing in the same millisecond would collide on the same key with
      // different payloads/fingerprints. `notify()` treats that as a genuine conflict
      // (`NotificationIdempotencyConflictError`), which this best-effort catch would then
      // swallow as a warning, silently dropping the second real alert. There is no natural
      // retry-stable business id for this operation (unlike password reset's consumed
      // token id) and no retry path if this notify() call itself fails, so a fresh
      // `randomUUID()` per call is more honest than a false idempotency guarantee built on
      // a timestamp that can repeat.
      try {
        await this.notifications.notify({
          recipientUserId: userId,
          type: 'account.profile_updated',
          payload: { updatedFields },
          idempotencyKey: `account.profile_updated:${randomUUID()}`,
        })
      } catch (err) {
        this.logger.warn(
          { userId, err: err instanceof Error ? err.message : 'unknown' },
          'Failed to emit profile-updated notification'
        )
      }
    }

    return this.mapUserToResponse(user)
  }

  /** Send password reset email (silent fail for unknown emails) */
  async forgotPassword(email: string, frontend?: BrowserFrontendContext): Promise<void> {
    const emailCanonical = this.emailIdentity.canonicalize(email)
    await this.authMailLimiter.reserve(emailCanonical, 'password_recovery')

    const user = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (!user) return // Silent fail — prevent email enumeration

    const { token } = await this.tokenManager.generatePasswordResetToken(user.id, frontend)

    const userLocale = coerceSupportedLocale(user.locale)
    const resetUrl = localizedFrontendUrl(
      frontend?.frontend === 'admin'
        ? resolveFrontendPlacement(this.env).admin
        : this.env.get('FRONTEND_URL'),
      userLocale,
      frontendAuthPath(frontend?.frontend ?? 'site', '/reset-password'),
      {
        token,
      }
    )
    const expiresInMinutes = Number(this.env.get('PASSWORD_RESET_EXPIRY_MINUTES'))

    // Best-effort: secret-bearing emails are sent directly (EQS-02) and
    // `sendNow` throws on provider failure. Swallow it here — letting a 500
    // surface for a known email while unknown emails return 200 would be an
    // account-enumeration oracle on this recovery endpoint. Never log the
    // reset URL/token — only the provider error message.
    try {
      await this.emailService.sendPasswordResetEmail(user.email, {
        name: user.name ?? user.email,
        resetUrl,
        expiresInMinutes,
        locale: userLocale,
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
  async resetPassword(
    token: string,
    newPassword: string,
    frontend?: BrowserFrontendContext
  ): Promise<void> {
    // Early resolve + reject for a plainly invalid/expired/used token (saves an argon2
    // hash on garbage). NOT the single-use guard — that is the atomic CAS below.
    const { id: resetTokenId, userId } = await this.tokenManager.verifyPasswordResetToken(
      token,
      frontend
    )

    const passwordHash = await argon2.hash(newPassword)
    const changedAt = new Date()

    await this.prisma.$transaction(
      async (tx) => {
        await lockMfaAccounts(tx, [userId])
        await lockAuthMailTokens(tx, userId)
        await this.tokenManager.consumeLocked(tx, token, 'password-reset', frontend)
        await tx.user.update({ where: { id: userId }, data: { passwordHash, emailVerified: true } })
        await advanceAccountSecurity(tx, userId)
      },
      { maxWait: 2000, timeout: 4000 }
    )

    await this.sessionService.deleteRevokedByUserId(userId)

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
  async verifyEmail(token: string, frontend?: BrowserFrontendContext): Promise<void> {
    const { userId } = await this.tokenManager.verifyEmailVerificationToken(token, frontend)
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
        await lockAuthMailTokens(tx, userId)
        await this.tokenManager.consumeLocked(tx, token, 'email-verification', frontend)
        await tx.user.update({ where: { id: userId }, data: { emailVerified: true } })
      },
      { maxWait: 2000, timeout: 4000 }
    )

    this.logger.info({ userId }, 'Email verified successfully')
  }

  /** Resend verification email (silent fail if already verified) */
  async resendVerificationEmail(email: string, frontend?: BrowserFrontendContext): Promise<void> {
    const emailCanonical = this.emailIdentity.canonicalize(email)
    await this.authMailLimiter.reserve(emailCanonical, 'email_verification')

    const user = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (!user || user.emailVerified) return // Silent fail

    let token: string
    try {
      ;({ token } = await this.tokenManager.generateEmailVerificationToken(user.id, frontend))
    } catch (error) {
      // Verification may finish while this request waits on the common token lock.
      if (error instanceof AppException && error.errorCode === AuthErrorCode.TOKEN_INVALID) return
      throw error
    }

    const userLocale = coerceSupportedLocale(user.locale)
    const verificationUrl = localizedFrontendUrl(
      frontend?.frontend === 'admin'
        ? resolveFrontendPlacement(this.env).admin
        : this.env.get('FRONTEND_URL'),
      userLocale,
      frontendAuthPath(frontend?.frontend ?? 'site', '/verify-email'),
      {
        token,
      }
    )
    const expiresInHours = Number(this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS'))

    // Best-effort, same enumeration rationale as forgotPassword: a direct-send
    // failure (EQS-02 `sendNow` throws) must not turn into a 500 that reveals
    // the account exists and is unverified. Never log the verification token.
    try {
      await this.emailService.sendEmailVerificationEmail(user.email, {
        name: user.name ?? user.email,
        verificationUrl,
        expiresInHours,
        locale: userLocale,
      })
      this.logger.info({ userId: user.id }, 'Verification email sent')
    } catch (err) {
      this.logger.warn(
        { userId: user.id, err: err instanceof Error ? err.message : 'unknown' },
        'Failed to send verification email'
      )
    }
  }

  /** Map Prisma user to API response */
  private mapUserToResponse(user: {
    id: string
    email: string
    emailVerified: boolean
    name: string | null
    avatarKey: string | null
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
      avatarUrl: avatarUrlOf(this.storage, user.avatarKey),
      phone: user.phone,
      locale: parseSupportedLocale(user.locale),
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
