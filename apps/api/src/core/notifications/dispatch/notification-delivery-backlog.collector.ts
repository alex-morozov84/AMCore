import { Injectable } from '@nestjs/common'

import { NotificationDeliveryStatus } from '@/generated/prisma/client'
import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/**
 * Non-terminal `NotificationDelivery` statuses — the real backlog behind the
 * `notifications` BullMQ queue. That queue carries only one-attempt
 * `DISPATCH_DUE` wake jobs (ADR-052); the authoritative schedule/backlog
 * lives in this table, which `amcore_queue_jobs` never reflects — a per-queue
 * BullMQ backlog alert on `notifications` would therefore be a documented
 * guard that cannot fire.
 *
 * `collectDue()`'s predicate deliberately mirrors
 * `NotificationDeliveryRepository`'s claim query — if you change one, change
 * the other, or the alertable count silently stops matching what the
 * dispatcher actually claims.
 */
const BACKLOG_STATUSES = [
  [NotificationDeliveryStatus.PENDING, 'pending'],
  [NotificationDeliveryStatus.PROCESSING, 'processing'],
  [NotificationDeliveryStatus.RETRY_SCHEDULED, 'retry_scheduled'],
] as const satisfies ReadonlyArray<readonly [NotificationDeliveryStatus, string]>

type BacklogLabels = 'status'

@Injectable()
export class NotificationDeliveryBacklogCollector {
  constructor(metrics: MetricsService, prisma: PrismaService) {
    metrics.registerGauge<BacklogLabels>({
      name: METRIC_NAMES.notificationDeliveryBacklog,
      help: 'Notification delivery outbox rows by non-terminal status (pending, processing, retry_scheduled) — the real backlog behind the "notifications" wake-job queue.',
      labelNames: ['status'],
      collect: async (gauge) => {
        const counts = await metrics.withCollectorTimeout<Record<string, number> | null>(
          'notification_delivery_backlog',
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
      name: METRIC_NAMES.notificationDeliveryDue,
      help: 'Notification delivery rows actionable now — PENDING past availableAt, or RETRY_SCHEDULED past nextAttemptAt. The alertable backlog quantity; raw pending includes healthy future-scheduled work.',
      labelNames: [],
      collect: async (gauge) => {
        const due = await metrics.withCollectorTimeout<number | null>(
          'notification_delivery_due',
          this.collectDue(prisma),
          null
        )

        // Unlike the labeled backlog gauge above, reset() on this zero-label
        // one does not make it vanish (prom-client keeps an implicit default
        // series) — a timeout reads back as a visible 0, not absence. Alert
        // on amcore_metrics_collector_errors_total{collector=
        // "notification_delivery_due"} to tell "timed out" apart from
        // "genuinely 0 due".
        gauge.reset()
        if (due === null) return
        gauge.set(due)
      },
    })
  }

  private async collectCounts(prisma: PrismaService): Promise<Record<string, number>> {
    const grouped = await prisma.notificationDelivery.groupBy({
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
   * Mirrors `NotificationDeliveryRepository.claimDueBatch()`'s claim predicate
   * exactly: `status IN (PENDING, RETRY_SCHEDULED) AND availableAt <= now()
   * AND (nextAttemptAt IS NULL OR nextAttemptAt <= now())` — a single
   * conjunction shared by both statuses, not one timestamp per status. Change
   * one, change the other.
   */
  private async collectDue(prisma: PrismaService): Promise<number> {
    const now = new Date()
    return prisma.notificationDelivery.count({
      where: {
        status: {
          in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRY_SCHEDULED],
        },
        availableAt: { lte: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
    })
  }
}
