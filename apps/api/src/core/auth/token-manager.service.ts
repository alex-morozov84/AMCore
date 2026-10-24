import { HttpStatus, Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import type { BrowserFrontendContext } from '../frontend-context/frontend-placement.js'
import { assertTokenFrontend, frontendTokenData } from '../frontend-context/frontend-token.js'

import { authMailClock, lockAuthMailTokens } from './auth-mail-token-lock.js'

export interface GeneratedToken {
  id: string
  token: string // Plain token — for email link
  expiresAt: Date
}

export type TokenType = 'password-reset' | 'email-verification'

@Injectable()
export class TokenManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(TokenManagerService.name)
  }

  /** Generate password reset token (15 min expiry) */
  async generatePasswordResetToken(
    userId: string,
    frontend?: BrowserFrontendContext,
    tx?: Prisma.TransactionClient
  ): Promise<GeneratedToken> {
    if (tx) return this.issue(tx, userId, 'password-reset', frontend)
    return this.prisma.$transaction(
      (client) => this.issue(client, userId, 'password-reset', frontend),
      { maxWait: 2000, timeout: 4000 }
    )
  }

  /**
   * Verify password reset token, return the row id, userId and tokenHash on success.
   * The row `id` is a non-secret stable handle for the consumed reset (used as the
   * `account.password_changed` notification idempotency key — unlike `tokenHash`, it
   * is safe to embed in notification rows/logs).
   */
  async verifyPasswordResetToken(
    token: string,
    frontend?: BrowserFrontendContext
  ): Promise<{ id: string; userId: string; tokenHash: string }> {
    const tokenHash = this.hashToken(token)

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    })

    if (!record || record.used || record.expiresAt < new Date()) {
      this.logger.warn('Invalid or expired password reset token attempted')
      throw new AppException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    assertTokenFrontend(record, frontend)
    return { id: record.id, userId: record.userId, tokenHash }
  }

  /** Mark password reset token as used */
  async consumePasswordResetToken(token: string): Promise<void> {
    const hint = await this.verifyPasswordResetToken(token)
    await this.prisma.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, hint.userId)
      await this.consumeLocked(tx, token, 'password-reset')
    })
  }

  /** Generate email verification token (48h expiry) */
  async generateEmailVerificationToken(
    userId: string,
    frontend?: BrowserFrontendContext,
    tx?: Prisma.TransactionClient
  ): Promise<GeneratedToken> {
    if (tx) return this.issue(tx, userId, 'email-verification', frontend)
    return this.prisma.$transaction(
      (client) => this.issue(client, userId, 'email-verification', frontend),
      { maxWait: 2000, timeout: 4000 }
    )
  }

  /** Verify email verification token, return userId and tokenHash on success */
  async verifyEmailVerificationToken(
    token: string,
    frontend?: BrowserFrontendContext
  ): Promise<{ userId: string; tokenHash: string }> {
    const tokenHash = this.hashToken(token)

    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    })

    if (!record || record.used || record.expiresAt < new Date()) {
      this.logger.warn('Invalid or expired email verification token attempted')
      throw new AppException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    assertTokenFrontend(record, frontend)
    return { userId: record.userId, tokenHash }
  }

  /** Mark email verification token as used */
  async consumeEmailVerificationToken(token: string): Promise<void> {
    const hint = await this.verifyEmailVerificationToken(token)
    await this.prisma.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, hint.userId)
      await this.consumeLocked(tx, token, 'email-verification')
    })
  }

  /** Invalidate all active tokens of given type for user */
  async invalidateUserTokens(userId: string, type: TokenType): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockAuthMailTokens(tx, userId)
      await this.invalidateLocked(tx, userId, type)
    })
  }

  private async invalidateLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    type: TokenType
  ): Promise<void> {
    if (type === 'password-reset')
      await tx.passwordResetToken.updateMany({
        where: { userId, used: false },
        data: { used: true },
      })
    else
      await tx.emailVerificationToken.updateMany({
        where: { userId, used: false },
        data: { used: true },
      })
  }

  private async issue(
    tx: Prisma.TransactionClient,
    userId: string,
    type: TokenType,
    frontend?: BrowserFrontendContext
  ): Promise<GeneratedToken> {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
    await lockAuthMailTokens(tx, userId)
    await tx.$queryRaw`SELECT id FROM core.users WHERE id=${userId} FOR SHARE`
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    })
    if (!user || (type === 'email-verification' && user.emailVerified)) throw this.invalidToken()
    const now = await authMailClock(tx)
    const expiresAt = this.getExpiry(type, now)
    const token = this.generateSecureToken()
    const data = {
      userId,
      tokenHash: this.hashToken(token),
      expiresAt,
      ...frontendTokenData(frontend),
    }
    await this.invalidateLocked(tx, userId, type)
    const row =
      type === 'password-reset'
        ? await tx.passwordResetToken.create({ data })
        : await tx.emailVerificationToken.create({ data })
    return { id: row.id, token, expiresAt }
  }

  /** Caller holds the common user lock. Final expiry is evaluated by SQL at the conditional write. */
  async consumeLocked(
    tx: Prisma.TransactionClient,
    token: string,
    type: TokenType,
    frontend?: BrowserFrontendContext
  ): Promise<{ id: string; userId: string }> {
    const tokenHash = this.hashToken(token)
    const row =
      type === 'password-reset'
        ? await tx.passwordResetToken.findUnique({ where: { tokenHash } })
        : await tx.emailVerificationToken.findUnique({ where: { tokenHash } })
    if (!row) throw this.invalidToken()
    // Recipient completion may wait on an unrelated profile write. Check expiry after that wait.
    await tx.$queryRaw`SELECT id FROM core.users WHERE id=${row.userId} FOR UPDATE`
    // A lock-only holder does not create a new row version or force UPDATE to recheck its predicate.
    if (type === 'password-reset')
      await tx.$queryRaw`SELECT id FROM core.password_reset_tokens WHERE id=${row.id} FOR UPDATE`
    else
      await tx.$queryRaw`SELECT id FROM core.email_verification_tokens WHERE id=${row.id} FOR UPDATE`
    const now = await authMailClock(tx)
    if (row.used || row.expiresAt <= now) throw this.invalidToken()
    assertTokenFrontend(row, frontend)
    const count =
      type === 'password-reset'
        ? await tx.$executeRaw`UPDATE core.password_reset_tokens SET used=true, "usedAt"=clock_timestamp() WHERE id=${row.id} AND NOT used AND "expiresAt">clock_timestamp()`
        : await tx.$executeRaw`UPDATE core.email_verification_tokens SET used=true, "usedAt"=clock_timestamp() WHERE id=${row.id} AND NOT used AND "expiresAt">clock_timestamp()`
    if (count !== 1) throw this.invalidToken()
    return { id: row.id, userId: row.userId }
  }

  private invalidToken(): AppException {
    return new AppException('Invalid or expired token', 401, AuthErrorCode.TOKEN_INVALID)
  }

  /** Generate cryptographically secure 64-char token */
  private generateSecureToken(): string {
    return randomBytes(32).toString('hex') // 64 hex chars
  }

  /**
   * SHA-256 lookup key for the 256-bit random mail token, never a human password.
   * A slow password KDF adds no protection against guessing this random value.
   * Preserve the digest format so previously issued links remain usable.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /** Get expiration date based on token type */
  private getExpiry(type: TokenType, now: Date): Date {
    const expiry = new Date(now)

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
