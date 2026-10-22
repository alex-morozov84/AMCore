import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { staleTerminalApiKeyWhere } from '../../core/api-keys/api-key-lifecycle.js'
import { InvitationRetentionService } from '../../core/invitations/invitation-retention.service.js'
import { PrismaService } from '../../prisma/index.js'

import { ScheduledJobExecutor } from './scheduled-job.executor.js'
import { ScheduledJob } from './scheduled-job.js'
import { bucketOutcome } from './scheduled-job-outcome.js'
import { CLEANUP_JOB } from './scheduled-jobs.catalogue.js'

/** Record types swept by cleanup; also the identifiers used in `failures`. */
export type CleanupRecordType =
  | 'expiredSessions'
  | 'expiredPasswordResetTokens'
  | 'expiredEmailVerificationTokens'
  | 'staleTerminalApiKeys'
  | 'expiredPendingInvites'
  | 'staleTerminalInvites'

export interface CleanupResult {
  expiredSessions: number
  expiredPasswordResetTokens: number
  expiredEmailVerificationTokens: number
  staleTerminalApiKeys: number
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

/**
 * CleanupService
 *
 * Removes expired records from the database on a nightly schedule.
 * Without this, tables grow unboundedly since tokens and sessions
 * are never deleted after expiry.
 *
 * Schedule: daily at 02:00 (process time zone; single instance via distributed lock — EQS-05).
 * The lock key and TTL (30 min: comfortably outlives a slow sweep, still expires on a crash) are
 * in `CLEANUP_JOB`. Manual trigger: POST /admin/cleanup (SUPER_ADMIN only)
 */
@Injectable()
export class CleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ScheduledJobExecutor,
    private readonly logger: PinoLogger,
    private readonly invitationRetention: InvitationRetentionService
  ) {
    this.logger.setContext(CleanupService.name)
  }

  @ScheduledJob(CLEANUP_JOB)
  async scheduledCleanup(): Promise<void> {
    // Multi-instance safety (EQS-05): every replica fires this cron at 02:00; the executor holds
    // the singleton lock so only the lock-winner runs the sweep, the rest skip, and no error
    // escapes as an unhandled cron rejection.
    //
    // The manual POST /admin/cleanup path is deliberately NOT lock-guarded and NOT recorded — it
    // is an explicit, throttled admin action, and every delete is idempotent
    // (delete-by-expiry), so a manual run overlapping a scheduled run on another
    // instance is harmless. It must not count as the scheduled run.
    await this.jobs.run(CLEANUP_JOB, async () => {
      this.logger.info('Starting scheduled cleanup')
      const result = await this.runCleanup()
      this.logger.info(
        { event: 'schedule.cleanup_complete', ...result },
        'Scheduled cleanup complete'
      )
      return bucketOutcome(result)
    })
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
        field: 'staleTerminalApiKeys',
        run: () => this.prisma.apiKey.deleteMany({ where: staleTerminalApiKeyWhere(now) }),
      },
      {
        field: 'expiredPendingInvites',
        run: () => this.invitationRetention.prune('pending'),
      },
      {
        field: 'staleTerminalInvites',
        run: () => this.invitationRetention.prune('terminal'),
      },
    ]

    const settled = await Promise.allSettled(tasks.map((task) => task.run()))

    const result: CleanupResult = {
      expiredSessions: 0,
      expiredPasswordResetTokens: 0,
      expiredEmailVerificationTokens: 0,
      staleTerminalApiKeys: 0,
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
