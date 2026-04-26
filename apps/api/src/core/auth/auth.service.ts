import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import type { LoginInput, RegisterInput, UserResponse } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { EmailService } from '../../infrastructure/email'
import { PrismaService } from '../../prisma'

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
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly loginRateLimiter: LoginRateLimiterService,
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

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        emailCanonical,
        passwordHash,
        name: input.name,
        lastLoginAt: new Date(),
      },
    })

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    })

    const { refreshToken } = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    // Queue welcome + verification emails (non-blocking, silent fail)
    void this.emailService
      .sendWelcomeEmail({
        name: user.name ?? user.email,
        email: user.email,
        locale: user.locale as 'ru' | 'en',
      })
      .catch((err: unknown) => this.logger.warn({ err }, 'Failed to send welcome email'))
    void this.resendVerificationEmail(user.email).catch((err: unknown) =>
      this.logger.warn({ err }, 'Failed to send verification email')
    )

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

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    })

    const { refreshToken } = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
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

  /** Get user by ID */
  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    return user ? this.mapUserToResponse(user) : null
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

    await this.emailService.sendPasswordResetEmail(user.email, {
      name: user.name ?? user.email,
      resetUrl,
      expiresIn,
      locale: user.locale as 'ru' | 'en',
    })

    this.logger.info({ userId: user.id }, 'Password reset email queued')
  }

  /** Reset password using token */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId, tokenHash } = await this.tokenManager.verifyPasswordResetToken(token)

    const passwordHash = await argon2.hash(newPassword)

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { tokenHash },
        data: { used: true, usedAt: new Date() },
      })

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      })
    })

    await this.sessionService.deleteAllByUserId(userId)
    await this.userCacheService.invalidateUser(userId)

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (user) {
      await this.emailService.sendPasswordChangedEmail(user.email, {
        name: user.name ?? user.email,
        changedAt: new Date().toISOString(),
        loginUrl: `${this.env.get('FRONTEND_URL')}/login`,
        supportEmail: this.env.get('SUPPORT_EMAIL'),
        locale: user.locale as 'ru' | 'en',
      })
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

    await this.emailService.sendEmailVerificationEmail(user.email, {
      name: user.name ?? user.email,
      verificationUrl,
      expiresIn,
      locale: user.locale as 'ru' | 'en',
    })

    this.logger.info({ userId: user.id }, 'Verification email queued')
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
      locale: user.locale,
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
