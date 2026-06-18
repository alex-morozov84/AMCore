import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../prisma'

import { SingletonCronRunner } from '@/infrastructure/schedule/singleton-cron.runner'

/**
 * Retention windows (ADR-052 §10). Hardcoded starter constants tuned by code change,
 * matching the cleanup/limiter convention — not env knobs. A row is deleted once it has
 * been in its terminal feed state past the window; the unread window is the longest
 * safety net. The feed is not an audit log — durable security events live in `AuditLog`.
 */
const RETENTION_ARCHIVED_DAYS = 30
const RETENTION_READ_DAYS = 90
const RETENTION_UNREAD_DAYS = 180
const RETENTION_FINISHED_ATTEMPTS_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Bounded batch + cycle cap so a single nightly run holds no long lock and cannot loop
 * unbounded on a large backlog (the next night continues). 500 × 200 = up to 100k rows
 * per bucket per run.
 */
const RETENTION_BATCH_LIMIT = 500
const RETENTION_MAX_CYCLES = 200

// Distributed-lock key + generous TTL (mirrors CleanupService): the daily cron fires on
// every replica, only the lock-winner sweeps; the TTL outlives a slow sweep yet expires
// on a crash. A missed run self-repairs next night (ADR-052 §10), so SingletonCronRunner's
// fail-closed-on-lock-failure is acceptable here (unlike the recovery poller).
const RETENTION_LOCK_KEY = 'amcore:notifications:retention:lock'
const RETENTION_LOCK_TTL_MS = 30 * 60 * 1000

/** Buckets swept by retention; also the identifiers used in `failures`. */
export type RetentionBucket =
  | 'archivedNotifications'
  | 'readNotifications'
  | 'unreadNotifications'
  | 'finishedAttempts'

export interface NotificationRetentionResult {
  archivedNotifications: number
  readNotifications: number
  unreadNotifications: number
  finishedAttempts: number
  /** Buckets whose delete failed this run; empty on full success. Never throws. */
  failures: RetentionBucket[]
}

/**
 * Worker-only notification retention (ADR-052 §10). Daily bounded/batched/idempotent
 * cleanup of the feed and the attempt history. Deleting a `Notification` cascades to its
 * deliveries and attempts (schema `onDelete: Cascade`), so the notification buckets
 * exclude any notification that still has an active external delivery
 * (`PENDING`/`PROCESSING`/`RETRY_SCHEDULED`) — active work is never auto-deleted. The
 * deletes are raw SQL `DELETE … WHERE id IN (SELECT … LIMIT n)` batched loops (Prisma
 * `deleteMany` has no `take`); each bucket is isolated so one failure neither aborts the
 * others nor throws (mirrors `CleanupService`).
 */
@Injectable()
export class NotificationRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly singletonCron: SingletonCronRunner,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationRetentionService.name)
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledRetention(): Promise<void> {
    // One replica sweeps; the rest skip. A skipped run self-repairs next night.
    await this.singletonCron.run(
      { name: 'notification.retention', lockKey: RETENTION_LOCK_KEY, ttlMs: RETENTION_LOCK_TTL_MS },
      async () => {
        const result = await this.runRetention()
        this.logger.info(
          { event: 'notification.retention_complete', ...result },
          'Notification retention complete'
        )
      }
    )
  }

  /**
   * Run every bucket independently (isolated via `Promise.allSettled`): a single failing
   * delete does not abort the others and never throws. Each delete is idempotent
   * (delete-by-age), so partial success is correct without a transaction.
   */
  async runRetention(now: Date = new Date()): Promise<NotificationRetentionResult> {
    const cutoff = (days: number): Date => new Date(now.getTime() - days * DAY_MS)
    const archivedCutoff = cutoff(RETENTION_ARCHIVED_DAYS)
    const readCutoff = cutoff(RETENTION_READ_DAYS)
    const unreadCutoff = cutoff(RETENTION_UNREAD_DAYS)
    const attemptsCutoff = cutoff(RETENTION_FINISHED_ATTEMPTS_DAYS)

    const tasks: { bucket: RetentionBucket; run: () => Promise<number> }[] = [
      {
        bucket: 'archivedNotifications',
        run: () =>
          this.deleteNotifications(Prisma.sql`n."archivedAt" IS NOT NULL
            AND n."archivedAt" < ${archivedCutoff}`),
      },
      {
        bucket: 'readNotifications',
        run: () =>
          this.deleteNotifications(Prisma.sql`n."archivedAt" IS NULL
            AND n."readAt" IS NOT NULL AND n."readAt" < ${readCutoff}`),
      },
      {
        bucket: 'unreadNotifications',
        run: () =>
          this.deleteNotifications(Prisma.sql`n."archivedAt" IS NULL
            AND n."readAt" IS NULL AND n."createdAt" < ${unreadCutoff}`),
      },
      { bucket: 'finishedAttempts', run: () => this.deleteFinishedAttempts(attemptsCutoff) },
    ]

    const settled = await Promise.allSettled(tasks.map((task) => task.run()))

    const result: NotificationRetentionResult = {
      archivedNotifications: 0,
      readNotifications: 0,
      unreadNotifications: 0,
      finishedAttempts: 0,
      failures: [],
    }

    settled.forEach((outcome, index) => {
      const { bucket } = tasks[index]!
      if (outcome.status === 'fulfilled') {
        result[bucket] = outcome.value
      } else {
        result.failures.push(bucket)
        this.logger.error(
          {
            event: 'notification.retention_partial_failure',
            bucket,
            error: outcome.reason instanceof Error ? outcome.reason.message : 'unknown',
          },
          'Notification retention task failed'
        )
      }
    })

    return result
  }

  /**
   * Delete notifications matching `predicate` in bounded batches. Excludes any
   * notification that still has an active external delivery so the cascade never removes
   * pending/in-flight/retrying work. Returns the total rows deleted.
   */
  private deleteNotifications(predicate: Prisma.Sql): Promise<number> {
    return this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "notifications"."notifications"
        WHERE id IN (
          SELECT n.id FROM "notifications"."notifications" n
          WHERE ${predicate}
            AND NOT EXISTS (
              SELECT 1 FROM "notifications"."notification_deliveries" d
              WHERE d."notificationId" = n.id
                AND d.status::text IN ('PENDING', 'PROCESSING', 'RETRY_SCHEDULED')
            )
          LIMIT ${limit}
        )
      `
    )
  }

  /** Prune finished (terminal) attempt history older than the window. */
  private deleteFinishedAttempts(cutoff: Date): Promise<number> {
    return this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "notifications"."notification_delivery_attempts"
        WHERE id IN (
          SELECT id FROM "notifications"."notification_delivery_attempts"
          WHERE "finishedAt" IS NOT NULL AND "finishedAt" < ${cutoff}
          LIMIT ${limit}
        )
      `
    )
  }

  /** Run a delete in bounded batches until a short batch (or the cycle cap) is reached. */
  private async deleteInBatches(build: (limit: number) => Prisma.Sql): Promise<number> {
    let total = 0
    for (let cycle = 0; cycle < RETENTION_MAX_CYCLES; cycle += 1) {
      const deleted = await this.prisma.$executeRaw(build(RETENTION_BATCH_LIMIT))
      total += deleted
      if (deleted < RETENTION_BATCH_LIMIT) break
    }
    return total
  }
}
