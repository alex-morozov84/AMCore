import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { AI_APPROVAL_EXPIRY_BATCH_LIMIT } from '@/core/ai/ai-run.constants'
import { ApprovalRaceError, expireApproval } from '@/core/ai/approvals/ai-approval-expiry'
import { AuditLogService } from '@/core/audit'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** One due approval claimed by the sweep (its run is guaranteed `WAITING_APPROVAL` by the query). */
interface DueApprovalRow {
  id: string
  runId: string
  deadlineAt: Date | null
}

/**
 * Worker-only approval-expiry sweep (Track C — ADR-054, Arc E.5b, ADR-052 pattern). Runs on **every**
 * worker replica — deliberately NOT `SingletonCronRunner` (fail-closed on a Redis lock failure); mutual
 * exclusion is the database's `FOR UPDATE ... SKIP LOCKED`, so it never collides with the web decision
 * path (which holds `FOR UPDATE OF a, r` on the same rows). Each due PENDING approval whose TTL has
 * elapsed is terminalized in its **own** transaction via the shared `expireApproval` (the single expiry
 * state machine — no drift from the decision freshness-gate); the metric is emitted **post-commit**.
 */
@Injectable()
export class AiApprovalExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiApprovalExpiryService.name)
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      const expired = await this.expireDue()
      if (expired > 0) {
        this.logger.warn(
          { event: 'ai.approval.expired_sweep', expired },
          'Terminalized stale AI approvals whose TTL/deadline elapsed'
        )
      }
    } catch (error) {
      // Never let a cron rejection escape; the next tick retries.
      this.logger.error(
        {
          event: 'ai.approval.expiry_failed',
          error: error instanceof Error ? error.message : 'unknown',
        },
        'AI approval expiry sweep failed'
      )
    }
  }

  /** Terminalize up to a bounded batch of due approvals, one isolated transaction each. */
  async expireDue(): Promise<number> {
    let expired = 0
    for (let i = 0; i < AI_APPROVAL_EXPIRY_BATCH_LIMIT; i += 1) {
      const outcome = await this.expireOne()
      if (outcome === 'none') break
      if (outcome === 'expired') {
        expired += 1
        this.metrics.incAiApproval('tool_invocation', 'expired') // post-commit
      }
      if (outcome === 'raced') break // defensive (unreachable under the run-status-filtered lock)
    }
    return expired
  }

  /**
   * Claim + expire ONE due approval in its own tx (`FOR UPDATE OF a, r SKIP LOCKED`, run filtered to
   * `WAITING_APPROVAL` so the shared `expireApproval` CAS counts always match). Returns whether it
   * expired one, found none due, or (defensively) hit a race that rolled its tx back.
   */
  private async expireOne(): Promise<'expired' | 'none' | 'raced'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date()
        const rows = await tx.$queryRaw<DueApprovalRow[]>(Prisma.sql`
          SELECT a.id, a."runId", r."deadlineAt"
          FROM "ai"."ai_approvals" a
          JOIN "ai"."ai_runs" r ON r.id = a."runId"
          WHERE a.state = 'PENDING'::"ai"."AiApprovalState"
            AND a."expiresAt" <= ${now}
            AND r.status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
          ORDER BY a."expiresAt"
          FOR UPDATE OF a, r SKIP LOCKED
          LIMIT 1
        `)
        const row = rows[0]
        if (row === undefined) return 'none' as const
        const deadlinePassed = row.deadlineAt !== null && row.deadlineAt <= now
        await expireApproval(tx, this.audit, {
          approvalId: row.id,
          runId: row.runId,
          deadlinePassed,
          now,
        })
        return 'expired' as const
      })
    } catch (error) {
      if (error instanceof ApprovalRaceError) return 'raced'
      throw error
    }
  }
}
