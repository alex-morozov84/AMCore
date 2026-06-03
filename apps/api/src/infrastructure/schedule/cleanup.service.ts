import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { SingletonCronRunner } from './singleton-cron.runner'

import { PrismaService } from '@/prisma'

/** Record types swept by cleanup; also the identifiers used in `failures`. */
export type CleanupRecordType =
  | 'expiredSessions'
  | 'expiredPasswordResetTokens'
  | 'expiredEmailVerificationTokens'
  | 'expiredApiKeys'
  | 'expiredPendingInvites'
  | 'staleTerminalInvites'

export interface CleanupResult {
  expiredSessions: number
  expiredPasswordResetTokens: number
  expiredEmailVerificationTokens: number
  expiredApiKeys: number
  expiredPendingInvites: number
  staleTerminalInvites: number
  /**
   * Record types whose delete failed this run (EQS-04). Empty on full success.
   * A per-type failure does not abort the others or throw — the caller gets the
   * counts that succeeded plus this list; each failure is also logged at error
   * level (`schedule.cleanup_partial_failure`).
   */
  failures: CleanupRecordType[]
}

// Terminal (accepted/revoked) invites are kept for an audit window after
// they reach their terminal state, then garbage-collected. Hardcoded
// starter constant (tune by code change) — see ai/SECURITY_AUDIT.md
// rationale shared with the invite expiry / limiter constants.
const INVITE_TERMINAL_RETENTION_DAYS = 30
const INVITE_TERMINAL_RETENTION_MS = INVITE_TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000

// Distributed-lock key + TTL for the nightly sweep (EQS-05). TTL is generous
// (30 min) so the lock comfortably outlives a slow sweep on large tables, yet
// still auto-expires if the holder crashes — the daily cron will not re-fire
// the same day, so there is no risk of a second run within the TTL window.
const CLEANUP_LOCK_KEY = 'amcore:schedule:cleanup:lock'
const CLEANUP_LOCK_TTL_MS = 30 * 60 * 1000

/**
 * CleanupService
 *
 * Removes expired records from the database on a nightly schedule.
 * Without this, tables grow unboundedly since tokens and sessions
 * are never deleted after expiry.
 *
 * Schedule: daily at 02:00 UTC (single instance via distributed lock — EQS-05)
 * Manual trigger: POST /admin/cleanup (SUPER_ADMIN only)
 */
@Injectable()
export class CleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly singletonCron: SingletonCronRunner,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CleanupService.name)
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledCleanup(): Promise<void> {
    // Multi-instance safety (EQS-05): every replica fires this cron at 02:00; the
    // singleton-cron runner ensures only the lock-winner runs the sweep, the rest
    // skip, and no error escapes as an unhandled cron rejection. The lock TTL
    // (`CLEANUP_LOCK_TTL_MS`) outlives a slow sweep but auto-expires on a crash.
    //
    // The manual POST /admin/cleanup path is deliberately NOT lock-guarded — it
    // is an explicit, throttled admin action, and every delete is idempotent
    // (delete-by-expiry), so a manual run overlapping a scheduled run on another
    // instance is harmless.
    await this.singletonCron.run(
      { name: 'schedule.cleanup', lockKey: CLEANUP_LOCK_KEY, ttlMs: CLEANUP_LOCK_TTL_MS },
      async () => {
        this.logger.info('Starting scheduled cleanup')
        const result = await this.runCleanup()
        this.logger.info(
          { event: 'schedule.cleanup_complete', ...result },
          'Scheduled cleanup complete'
        )
      }
    )
  }

  /**
   * Run every cleanup task independently (EQS-04). Tasks are isolated via
   * `Promise.allSettled`: a single failing delete does not abort the others and
   * never throws — the failed type's count stays 0, it is added to `failures`,
   * and a stable error event is logged. Each delete is its own idempotent
   * statement, so partial success is correct (no transaction needed). Even an
   * all-failed run returns a structured `CleanupResult`, not an exception.
   */
  async runCleanup(): Promise<CleanupResult> {
    const now = new Date()
    const terminalCutoff = new Date(now.getTime() - INVITE_TERMINAL_RETENTION_MS)

    const tasks: { field: CleanupRecordType; run: () => Promise<{ count: number }> }[] = [
      {
        field: 'expiredSessions',
        run: () => this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      },
      {
        field: 'expiredPasswordResetTokens',
        run: () => this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      },
      {
        field: 'expiredEmailVerificationTokens',
        run: () =>
          this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      },
      {
        field: 'expiredApiKeys',
        run: () => this.prisma.apiKey.deleteMany({ where: { expiresAt: { lt: now } } }),
      },
      {
        // Expired pending invites: past expiry and never accepted/revoked.
        field: 'expiredPendingInvites',
        run: () =>
          this.prisma.orgInvite.deleteMany({
            where: { expiresAt: { lt: now }, acceptedAt: null, revokedAt: null },
          }),
      },
      {
        // Terminal invites past the audit-retention window. A terminal row has
        // exactly one of acceptedAt / revokedAt set, so the OR keeps active and
        // not-yet-expired pending rows untouched.
        field: 'staleTerminalInvites',
        run: () =>
          this.prisma.orgInvite.deleteMany({
            where: {
              OR: [{ acceptedAt: { lt: terminalCutoff } }, { revokedAt: { lt: terminalCutoff } }],
            },
          }),
      },
    ]

    const settled = await Promise.allSettled(tasks.map((task) => task.run()))

    const result: CleanupResult = {
      expiredSessions: 0,
      expiredPasswordResetTokens: 0,
      expiredEmailVerificationTokens: 0,
      expiredApiKeys: 0,
      expiredPendingInvites: 0,
      staleTerminalInvites: 0,
      failures: [],
    }

    settled.forEach((outcome, index) => {
      const { field } = tasks[index]!
      if (outcome.status === 'fulfilled') {
        result[field] = outcome.value.count
      } else {
        result.failures.push(field)
        this.logger.error(
          {
            event: 'schedule.cleanup_partial_failure',
            recordType: field,
            error: outcome.reason instanceof Error ? outcome.reason.message : 'unknown',
          },
          'Cleanup task failed'
        )
      }
    })

    return result
  }
}
