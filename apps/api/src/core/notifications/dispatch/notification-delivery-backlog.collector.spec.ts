import { NotificationDeliveryBacklogCollector } from './notification-delivery-backlog.collector'

import { NotificationDeliveryStatus } from '@/generated/prisma/client'
import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

describe('NotificationDeliveryBacklogCollector', () => {
  const services: MetricsService[] = []

  function makeMetrics(): MetricsService {
    const env = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PROCESS_ROLE: 'worker',
          NODE_ENV: 'test',
          METRICS_ENABLED: true,
          APP_VERSION: '0.0.0-test',
          APP_COMMIT: 'deadbeef',
        }
        return values[key]
      }),
    }
    const metrics = new MetricsService(env as never)
    services.push(metrics)
    return metrics
  }

  afterEach(() => {
    jest.useRealTimers()
    for (const service of services.splice(0)) {
      service.onModuleDestroy()
    }
  })

  it('exposes per-status backlog counts, defaulting an absent status to 0', async () => {
    const metrics = makeMetrics()
    const groupBy = jest.fn().mockResolvedValue([
      { status: NotificationDeliveryStatus.PENDING, _count: 3 },
      { status: NotificationDeliveryStatus.RETRY_SCHEDULED, _count: 2 },
    ])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { notificationDelivery: { groupBy, count } } as unknown as PrismaService

    new NotificationDeliveryBacklogCollector(metrics, prisma)

    const output = await metrics.metrics()
    expect(output).toMatch(
      new RegExp(`${METRIC_NAMES.notificationDeliveryBacklog}\\{status="pending"[^}]*} 3`)
    )
    expect(output).toMatch(
      new RegExp(`${METRIC_NAMES.notificationDeliveryBacklog}\\{status="retry_scheduled"[^}]*} 2`)
    )
    expect(output).toMatch(
      new RegExp(`${METRIC_NAMES.notificationDeliveryBacklog}\\{status="processing"[^}]*} 0`)
    )
  })

  it("mirrors NotificationDeliveryRepository.claimDueBatch()'s claim predicate exactly (R1)", async () => {
    const metrics = makeMetrics()
    const groupBy = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(5)
    const prisma = { notificationDelivery: { groupBy, count } } as unknown as PrismaService

    new NotificationDeliveryBacklogCollector(metrics, prisma)
    await metrics.metrics()

    expect(count).toHaveBeenCalledTimes(1)
    const { where } = count.mock.calls[0][0] as {
      where: Record<string, unknown>
    }
    // A single conjunction shared by both statuses — NOT one timestamp per
    // status — is the exact claim-query shape this must mirror.
    expect(where.status).toEqual({
      in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRY_SCHEDULED],
    })
    expect(where.availableAt).toEqual({ lte: expect.any(Date) })
    expect(where.OR).toEqual([
      { nextAttemptAt: null },
      { nextAttemptAt: { lte: expect.any(Date) } },
    ])

    const output = await metrics.metrics()
    expect(output).toMatch(new RegExp(`${METRIC_NAMES.notificationDeliveryDue}\\{[^}]*} 5`))
  })

  it('bounds a stalled query and resets both gauges to empty, counting a collector error, on timeout', async () => {
    jest.useFakeTimers()
    const metrics = makeMetrics()
    const groupBy = jest.fn(
      (): Promise<Array<{ status: NotificationDeliveryStatus; _count: number }>> =>
        new Promise(() => undefined)
    )
    const count = jest.fn((): Promise<number> => new Promise(() => undefined))
    const prisma = { notificationDelivery: { groupBy, count } } as unknown as PrismaService

    new NotificationDeliveryBacklogCollector(metrics, prisma)

    const pending = metrics.metrics()
    await jest.advanceTimersByTimeAsync(150)
    const failedScrape = await pending

    expect(failedScrape).not.toContain(`${METRIC_NAMES.notificationDeliveryBacklog}{`)
    // The zero-label `_due` gauge does not disappear on reset() the way the
    // labeled backlog one does above (prom-client keeps an implicit default
    // series for a zero-label metric) — it reads back as 0, not absent.
    expect(failedScrape).toMatch(new RegExp(`${METRIC_NAMES.notificationDeliveryDue}\\{[^}]*} 0`))

    // The collector-error counters are incremented mid-scrape by these
    // gauges' own collect(), *after* the counter's own exposition text was
    // already serialized (registration order) — so they only show up on the
    // *next* scrape, matching queue-depth-metrics.collector.spec.ts's
    // established pattern. Let the next queries resolve so it doesn't stall.
    groupBy.mockResolvedValue([])
    count.mockResolvedValue(0)
    const nextScrape = await metrics.metrics()
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="notification_delivery_backlog"`
    )
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="notification_delivery_due"`
    )
  })
})
