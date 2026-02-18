import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import * as argon2 from 'argon2'
import type { Cache } from 'cache-manager'

import type { LoginInput, RegisterInput, UserResponse } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { EmailService } from '../../infrastructure/email'
import { PrismaService } from '../../prisma'

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
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenManager: TokenManagerService,
    private readonly sessionService: SessionService,
    private readonly emailService: EmailService,
    private readonly userCacheService: UserCacheService,
    private readonly env: EnvService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache
  ) {}

  /** Register new user */
  async register(input: RegisterInput, requestInfo: RequestInfo): Promise<AuthResult> {
    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
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
        email: input.email,
        passwordHash,
        name: input.name,
        lastLoginAt: new Date(),
      },
    })

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    })

    const refreshToken = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    // Queue welcome + verification emails (non-blocking)
    void this.emailService.sendWelcomeEmail({
      name: user.name ?? user.email,
      email: user.email,
      locale: user.locale as 'ru' | 'en',
    })
    void this.resendVerificationEmail(user.email)

    this.logger.log('User registered successfully', {
      userId: user.id,
      email: user.email,
    })

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    }
  }

  /** Login user */
  async login(input: LoginInput, requestInfo: RequestInfo): Promise<AuthResult> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    })

    if (!user || !user.passwordHash) {
      throw new AppException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS
      )
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, input.password)
    if (!valid) {
      throw new AppException(
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.INVALID_CREDENTIALS
      )
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    })

    const refreshToken = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    this.logger.log('User logged in successfully', {
      userId: user.id,
      email: user.email,
    })

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    }
  }

  /** Logout (invalidate refresh token) */
  async logout(refreshTokenHash: string): Promise<void> {
    await this.sessionService.deleteByRefreshToken(refreshTokenHash)
    this.logger.log('User logged out successfully')
  }

  /** Get user by ID */
  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } })
    return user ? this.mapUserToResponse(user) : null
  }

  /** Send password reset email (silent fail for unknown emails) */
  async forgotPassword(email: string): Promise<void> {
    await this.checkRateLimit(`forgot:${email}`, 3)

    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) return // Silent fail — prevent email enumeration

    const { token } = await this.tokenManager.generatePasswordResetToken(user.id)

    const resetUrl = `${this.env.get('FRONTEND_URL')}/reset-password?token=${token}`
    const expiresIn = `${this.env.get('PASSWORD_RESET_EXPIRY_MINUTES')} минут`

    await this.emailService.sendPasswordResetEmail(email, {
      name: user.name ?? email,
      resetUrl,
      expiresIn,
      locale: user.locale as 'ru' | 'en',
    })

    this.logger.log('Password reset email queued', { userId: user.id })
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

    this.logger.log('Password reset successfully', { userId })
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

    this.logger.log('Email verified successfully', { userId })
  }

  /** Resend verification email (silent fail if already verified) */
  async resendVerificationEmail(email: string): Promise<void> {
    await this.checkRateLimit(`resend-verification:${email}`, 3)

    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || user.emailVerified) return // Silent fail

    const { token } = await this.tokenManager.generateEmailVerificationToken(user.id)

    const verificationUrl = `${this.env.get('FRONTEND_URL')}/verify-email?token=${token}`
    const expiresIn = `${this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS')} часов`

    await this.emailService.sendEmailVerificationEmail(email, {
      name: user.name ?? email,
      verificationUrl,
      expiresIn,
      locale: user.locale as 'ru' | 'en',
    })

    this.logger.log('Verification email queued', { userId: user.id })
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
      locale: user.locale,
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
