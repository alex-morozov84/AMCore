import { AiRunBacklogCollector } from './ai-run-backlog.collector'

import { AiRunStatus } from '@/generated/prisma/client'
import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'
import type { PrismaService } from '@/prisma'

describe('AiRunBacklogCollector', () => {
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
      { status: AiRunStatus.QUEUED, _count: 4 },
      { status: AiRunStatus.WAITING_APPROVAL, _count: 1 },
    ])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { aiRun: { groupBy, count } } as unknown as PrismaService

    new AiRunBacklogCollector(metrics, prisma)

    const output = await metrics.metrics()
    expect(output).toMatch(new RegExp(`${METRIC_NAMES.aiRunBacklog}\\{status="queued"[^}]*} 4`))
    expect(output).toMatch(
      new RegExp(`${METRIC_NAMES.aiRunBacklog}\\{status="waiting_approval"[^}]*} 1`)
    )
    expect(output).toMatch(new RegExp(`${METRIC_NAMES.aiRunBacklog}\\{status="running"[^}]*} 0`))
  })

  it("mirrors AiRunRepository.claimDueBatch()'s claim predicate exactly, INCLUDING deadlineAt (R1)", async () => {
    const metrics = makeMetrics()
    const groupBy = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(2)
    const prisma = { aiRun: { groupBy, count } } as unknown as PrismaService

    new AiRunBacklogCollector(metrics, prisma)
    await metrics.metrics()

    expect(count).toHaveBeenCalledTimes(1)
    const { where } = count.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(where.status).toBe(AiRunStatus.QUEUED)
    expect(where.availableAt).toEqual({ lte: expect.any(Date) })
    // The deadlineAt clause is the one a run past deadline (unclaimable, but
    // not yet swept by the recovery cron) would otherwise silently count as
    // "due" without — the exact bug this test exists to pin.
    expect(where.AND).toEqual([
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }] },
      { OR: [{ deadlineAt: null }, { deadlineAt: { gt: expect.any(Date) } }] },
    ])

    const output = await metrics.metrics()
    expect(output).toMatch(new RegExp(`${METRIC_NAMES.aiRunDue}\\{[^}]*} 2`))
  })

  it('bounds a stalled query and resets both gauges to empty, counting a collector error, on timeout', async () => {
    jest.useFakeTimers()
    const metrics = makeMetrics()
    const groupBy = jest.fn(
      (): Promise<Array<{ status: AiRunStatus; _count: number }>> => new Promise(() => undefined)
    )
    const count = jest.fn((): Promise<number> => new Promise(() => undefined))
    const prisma = { aiRun: { groupBy, count } } as unknown as PrismaService

    new AiRunBacklogCollector(metrics, prisma)

    const pending = metrics.metrics()
    await jest.advanceTimersByTimeAsync(150)
    const failedScrape = await pending

    expect(failedScrape).not.toContain(`${METRIC_NAMES.aiRunBacklog}{`)
    // The zero-label `_due` gauge does not disappear on reset() the way the
    // labeled backlog one does above (prom-client keeps an implicit default
    // series for a zero-label metric) — it reads back as 0, not absent.
    expect(failedScrape).toMatch(new RegExp(`${METRIC_NAMES.aiRunDue}\\{[^}]*} 0`))

    // The collector-error counters are incremented mid-scrape by these
    // gauges' own collect(), *after* the counter's own exposition text was
    // already serialized (registration order) — so they only show up on the
    // *next* scrape, matching queue-depth-metrics.collector.spec.ts's
    // established pattern. Let the next queries resolve so it doesn't stall.
    groupBy.mockResolvedValue([])
    count.mockResolvedValue(0)
    const nextScrape = await metrics.metrics()
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="ai_run_backlog"`
    )
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="ai_run_due"`
    )
  })
})
