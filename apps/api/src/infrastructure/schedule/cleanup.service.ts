import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '@/prisma'

export interface CleanupResult {
  expiredSessions: number
  expiredPasswordResetTokens: number
  expiredEmailVerificationTokens: number
  expiredApiKeys: number
  expiredPendingInvites: number
  staleTerminalInvites: number
}

// Terminal (accepted/revoked) invites are kept for an audit window after
// they reach their terminal state, then garbage-collected. Hardcoded
// starter constant (tune by code change) — see ai/SECURITY_AUDIT.md
// rationale shared with the invite expiry / limiter constants.
const INVITE_TERMINAL_RETENTION_DAYS = 30
const INVITE_TERMINAL_RETENTION_MS = INVITE_TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CleanupService.name)
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledCleanup(): Promise<void> {
    this.logger.info('Starting scheduled cleanup')
    const result = await this.runCleanup()
    this.logger.info(result, 'Scheduled cleanup complete')
  }

  async runCleanup(): Promise<CleanupResult> {
    const now = new Date()
    const terminalCutoff = new Date(now.getTime() - INVITE_TERMINAL_RETENTION_MS)

    const [
      sessions,
      passwordResetTokens,
      emailVerificationTokens,
      apiKeys,
      pendingInvites,
      terminalInvites,
    ] = await Promise.all([
      this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.apiKey.deleteMany({ where: { expiresAt: { lt: now } } }),
      // Expired pending invites: past expiry and never accepted/revoked.
      this.prisma.orgInvite.deleteMany({
        where: { expiresAt: { lt: now }, acceptedAt: null, revokedAt: null },
      }),
      // Terminal invites past the audit-retention window. A terminal row
      // has exactly one of acceptedAt / revokedAt set, so the OR keeps
      // active and not-yet-expired pending rows untouched.
      this.prisma.orgInvite.deleteMany({
        where: {
          OR: [{ acceptedAt: { lt: terminalCutoff } }, { revokedAt: { lt: terminalCutoff } }],
        },
      }),
    ])

    return {
      expiredSessions: sessions.count,
      expiredPasswordResetTokens: passwordResetTokens.count,
      expiredEmailVerificationTokens: emailVerificationTokens.count,
      expiredApiKeys: apiKeys.count,
      expiredPendingInvites: pendingInvites.count,
      staleTerminalInvites: terminalInvites.count,
    }
  }
}
