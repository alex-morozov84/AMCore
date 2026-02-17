import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'

import { EnvService } from '../../env/env.service'
import { PrismaService } from '../../prisma'

export interface GeneratedToken {
  token: string // Plain token — for email link
  expiresAt: Date
}

export type TokenType = 'password-reset' | 'email-verification'

@Injectable()
export class TokenManagerService {
  private readonly logger = new Logger(TokenManagerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  /** Generate password reset token (15 min expiry) */
  async generatePasswordResetToken(userId: string): Promise<GeneratedToken> {
    // Invalidate existing active tokens
    await this.invalidateUserTokens(userId, 'password-reset')

    const token = this.generateSecureToken()
    const tokenHash = this.hashToken(token)
    const expiresAt = this.getExpiry('password-reset')

    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    })

    this.logger.log('Password reset token generated', { userId })

    return { token, expiresAt }
  }

  /** Verify password reset token, return userId and tokenHash on success */
  async verifyPasswordResetToken(token: string): Promise<{ userId: string; tokenHash: string }> {
    const tokenHash = this.hashToken(token)

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    })

    if (!record || record.used || record.expiresAt < new Date()) {
      this.logger.warn('Invalid or expired password reset token attempted')
      throw new UnauthorizedException('Invalid or expired token')
    }

    return { userId: record.userId, tokenHash }
  }

  /** Mark password reset token as used */
  async consumePasswordResetToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token)

    await this.prisma.passwordResetToken.update({
      where: { tokenHash },
      data: { used: true, usedAt: new Date() },
    })
  }

  /** Generate email verification token (48h expiry) */
  async generateEmailVerificationToken(userId: string): Promise<GeneratedToken> {
    // Invalidate existing active tokens
    await this.invalidateUserTokens(userId, 'email-verification')

    const token = this.generateSecureToken()
    const tokenHash = this.hashToken(token)
    const expiresAt = this.getExpiry('email-verification')

    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    })

    this.logger.log('Email verification token generated', { userId })

    return { token, expiresAt }
  }

  /** Verify email verification token, return userId and tokenHash on success */
  async verifyEmailVerificationToken(
    token: string
  ): Promise<{ userId: string; tokenHash: string }> {
    const tokenHash = this.hashToken(token)

    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    })

    if (!record || record.used || record.expiresAt < new Date()) {
      this.logger.warn('Invalid or expired email verification token attempted')
      throw new UnauthorizedException('Invalid or expired token')
    }

    return { userId: record.userId, tokenHash }
  }

  /** Mark email verification token as used */
  async consumeEmailVerificationToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token)

    await this.prisma.emailVerificationToken.update({
      where: { tokenHash },
      data: { used: true, usedAt: new Date() },
    })
  }

  /** Invalidate all active tokens of given type for user */
  async invalidateUserTokens(userId: string, type: TokenType): Promise<void> {
    if (type === 'password-reset') {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId, used: false },
        data: { used: true },
      })
    } else {
      await this.prisma.emailVerificationToken.updateMany({
        where: { userId, used: false },
        data: { used: true },
      })
    }
  }

  /** Generate cryptographically secure 64-char token */
  private generateSecureToken(): string {
    return randomBytes(32).toString('hex') // 64 hex chars
  }

  /** Hash token with SHA-256 for storage */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /** Get expiration date based on token type */
  private getExpiry(type: TokenType): Date {
    const expiry = new Date()

    if (type === 'password-reset') {
      const minutes = this.env.get('PASSWORD_RESET_EXPIRY_MINUTES')
      expiry.setMinutes(expiry.getMinutes() + minutes)
    } else {
      const hours = this.env.get('EMAIL_VERIFICATION_EXPIRY_HOURS')
      expiry.setHours(expiry.getHours() + hours)
    }

    return expiry
  }
}
