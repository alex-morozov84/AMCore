import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { PrismaService } from '@/prisma'

export interface CleanupResult {
  expiredSessions: number
  expiredPasswordResetTokens: number
  expiredEmailVerificationTokens: number
  expiredApiKeys: number
}

/**
 * CleanupService
 *
 * Removes expired records from the database on a nightly schedule.
 * Without this, tables grow unboundedly since tokens and sessions
 * are never deleted after expiry.
 *
 * Schedule: daily at 02:00 UTC
 * Manual trigger: POST /admin/cleanup (SUPER_ADMIN only)
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledCleanup(): Promise<void> {
    this.logger.log('Starting scheduled cleanup')
    const result = await this.runCleanup()
    this.logger.log('Scheduled cleanup complete', result)
  }

  async runCleanup(): Promise<CleanupResult> {
    const now = new Date()

    const [sessions, passwordResetTokens, emailVerificationTokens, apiKeys] = await Promise.all([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.apiKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    ])

    return {
      expiredSessions: sessions.count,
      expiredPasswordResetTokens: passwordResetTokens.count,
      expiredEmailVerificationTokens: emailVerificationTokens.count,
      expiredApiKeys: apiKeys.count,
    }
  }
}
