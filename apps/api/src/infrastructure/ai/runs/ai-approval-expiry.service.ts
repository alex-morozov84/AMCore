import { Inject, Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { AI_RUN_SHUTDOWN_LATCH } from './ai-run-shutdown'

import { AI_APPROVAL_EXPIRY_BATCH_LIMIT } from '@/core/ai/ai-run.constants'
import { ApprovalRaceError, expireApproval } from '@/core/ai/approvals/ai-approval-expiry'
import { AuditLogService } from '@/core/audit'
import { Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { CUTOFF, type ShutdownLatch } from '@/infrastructure/worker-lifecycle'
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
 * path. Lock order is **run → approval** like every other path (see `core/ai/ai-run-locks`): a due
 * candidate is selected unlocked, its run is locked `SKIP LOCKED`, and only then its approval — a run
 * busy with a decision, cancel, takeover or the worker's guard is simply left for the next tick. Each due
 * PENDING approval whose TTL has elapsed is terminalized in its **own** transaction via the shared
 * `expireApproval` (the single expiry state machine — no drift from the decision freshness-gate); the
 * metric is emitted **post-commit**. The sweep runs through the dispatcher's shutdown latch: once
 * closed it starts nothing, and a sealed latch rolls an interrupted expiry back whole.
 */
@Injectable()
export class AiApprovalExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    @Inject(AI_RUN_SHUTDOWN_LATCH) private readonly latch: ShutdownLatch,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiApprovalExpiryService.name)
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (this.latch.closed) return
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
    for (let i = 0; i < AI_APPROVAL_EXPIRY_BATCH_LIMIT && !this.latch.closed; i += 1) {
      const outcome = await this.expireOne()
      if (outcome === 'none') break
      if (outcome === 'expired') {
        expired += 1
        this.metrics.incAiApproval('tool_invocation', 'expired') // post-commit
      }
      if (outcome === 'raced') break // its run is busy with another path: next tick
    }
    return expired
  }

  /**
   * Claim + expire ONE due approval in its own tx. Returns whether it expired one, found none due, or hit
   * a busy run / lost race (which rolled its tx back and leaves the approval for the next tick).
   */
  private async expireOne(): Promise<'expired' | 'none' | 'raced'> {
    try {
      const outcome = await this.latch.transaction(this.prisma, async (tx) => {
        const now = new Date()
        const candidates = await tx.$queryRaw<{ id: string; runId: string }[]>(Prisma.sql`
          SELECT a.id, a."runId"
          FROM "ai"."ai_approvals" a
          JOIN "ai"."ai_runs" r ON r.id = a."runId"
          WHERE a.state = 'PENDING'::"ai"."AiApprovalState"
            AND a."expiresAt" <= ${now}
            AND r.status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
          ORDER BY a."expiresAt"
          LIMIT 1
        `)
        const candidate = candidates[0]
        if (candidate === undefined) return 'none' as const

        // Run FIRST (SKIP LOCKED: never wait behind a decision/cancel/takeover/guard), then the approval.
        const lockedRun = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM "ai"."ai_runs" WHERE id = ${candidate.runId} FOR UPDATE SKIP LOCKED
        `)
        if (lockedRun.length === 0) return 'raced' as const
        const rows = await tx.$queryRaw<DueApprovalRow[]>(Prisma.sql`
          SELECT a.id, a."runId", r."deadlineAt"
          FROM "ai"."ai_approvals" a
          JOIN "ai"."ai_runs" r ON r.id = a."runId"
          WHERE a.id = ${candidate.id}
            AND a.state = 'PENDING'::"ai"."AiApprovalState"
            AND a."expiresAt" <= ${now}
            AND r.status = 'WAITING_APPROVAL'::"ai"."AiRunStatus"
          FOR UPDATE OF a SKIP LOCKED
        `)
        const row = rows[0]
        if (row === undefined) return 'raced' as const
        const deadlinePassed = row.deadlineAt !== null && row.deadlineAt <= now
        await expireApproval(tx, this.audit, {
          approvalId: row.id,
          runId: row.runId,
          deadlinePassed,
          now,
        })
        return 'expired' as const
      })
      return outcome === CUTOFF ? 'none' : outcome
    } catch (error) {
      if (error instanceof ApprovalRaceError) return 'raced'
      throw error
    }
  }
}
