import { Injectable } from '@nestjs/common'

import { AiRunStatus } from '@/generated/prisma/client'
import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/**
 * Non-terminal `AiRun` statuses — the real backlog behind the `ai-runs`
 * BullMQ queue. That queue carries only one-attempt `AI_RUN_WAKE` wake jobs
 * (ADR-054); the authoritative schedule/backlog lives in this table, which
 * `amcore_queue_jobs` never reflects.
 *
 * `collectDue()`'s predicate deliberately mirrors `AiRunRepository`'s claim
 * query — if you change one, change the other, or the alertable count
 * silently stops matching what the executor actually claims.
 */
const BACKLOG_STATUSES = [
  [AiRunStatus.QUEUED, 'queued'],
  [AiRunStatus.RUNNING, 'running'],
  [AiRunStatus.WAITING_APPROVAL, 'waiting_approval'],
  [AiRunStatus.WAITING_HUMAN, 'waiting_human'],
] as const satisfies ReadonlyArray<readonly [AiRunStatus, string]>

type BacklogLabels = 'status'

@Injectable()
export class AiRunBacklogCollector {
  constructor(metrics: MetricsService, prisma: PrismaService) {
    metrics.registerGauge<BacklogLabels>({
      name: METRIC_NAMES.aiRunBacklog,
      help: 'AI run rows by non-terminal status (queued, running, waiting_approval, waiting_human) — the real backlog behind the "ai-runs" wake-job queue.',
      labelNames: ['status'],
      collect: async (gauge) => {
        const counts = await metrics.withCollectorTimeout<Record<string, number> | null>(
          'ai_run_backlog',
          this.collectCounts(prisma),
          null
        )

        gauge.reset()
        if (!counts) return
        for (const [, label] of BACKLOG_STATUSES) {
          gauge.set({ status: label }, counts[label] ?? 0)
        }
      },
    })

    metrics.registerGauge<never>({
      name: METRIC_NAMES.aiRunDue,
      help: 'AI run rows actionable now — QUEUED, past availableAt, with no future nextAttemptAt, and not past its deadline. Excludes waiting_approval/waiting_human, which are intentionally parked for a human, not stuck. The alertable backlog quantity.',
      labelNames: [],
      collect: async (gauge) => {
        const due = await metrics.withCollectorTimeout<number | null>(
          'ai_run_due',
          this.collectDue(prisma),
          null
        )

        // Unlike the labeled backlog gauge above, reset() on this zero-label
        // one does not make it vanish (prom-client keeps an implicit default
        // series) — a timeout reads back as a visible 0, not absence. Alert
        // on amcore_metrics_collector_errors_total{collector="ai_run_due"}
        // to tell "timed out" apart from "genuinely 0 due".
        gauge.reset()
        if (due === null) return
        gauge.set(due)
      },
    })
  }

  private async collectCounts(prisma: PrismaService): Promise<Record<string, number>> {
    const grouped = await prisma.aiRun.groupBy({
      by: ['status'],
      where: { status: { in: BACKLOG_STATUSES.map(([status]) => status) } },
      _count: true,
    })

    const counts: Record<string, number> = {}
    for (const [status, label] of BACKLOG_STATUSES) {
      counts[label] = grouped.find((row) => row.status === status)?._count ?? 0
    }
    return counts
  }

  /**
   * Mirrors `AiRunRepository.claimDueBatch()`'s claim predicate exactly:
   * `status='QUEUED' AND availableAt<=now() AND (nextAttemptAt IS NULL OR
   * nextAttemptAt<=now()) AND (deadlineAt IS NULL OR deadlineAt>now())`. The
   * `deadlineAt` clause matters: a `QUEUED` run past its deadline is
   * unclaimable — `AiRunRecoveryService`'s `@Cron` sweeps it to `EXPIRED`,
   * but only while the worker is up. Omitting this clause here would count
   * that row as "due" while a stalled worker leaves it stuck forever, i.e.
   * the false-green case an operator staring at this gauge cares about most.
   */
  private async collectDue(prisma: PrismaService): Promise<number> {
    const now = new Date()
    return prisma.aiRun.count({
      where: {
        status: AiRunStatus.QUEUED,
        availableAt: { lte: now },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }] },
        ],
      },
    })
  }
}
