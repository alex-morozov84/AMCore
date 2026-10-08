import { AiRunBacklogCollector } from './ai-run-backlog.collector'
import { aiRunExecutionEligibility } from './ai-run-execution-eligibility'

import { AiRunStatus, Prisma } from '@/generated/prisma/client'
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
    const count = jest.fn().mockResolvedValue([{ count: 0n }])
    const prisma = { aiRun: { groupBy }, $queryRaw: count } as unknown as PrismaService

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
    const count = jest.fn().mockResolvedValue([{ count: 2n }])
    const prisma = { aiRun: { groupBy }, $queryRaw: count } as unknown as PrismaService

    new AiRunBacklogCollector(metrics, prisma)
    await metrics.metrics()

    expect(count).toHaveBeenCalledTimes(1)
    const query = count.mock.calls[0]![0] as Prisma.Sql
    const predicate = aiRunExecutionEligibility(Prisma.sql`timing.at`)
    expect(query.sql).toContain(predicate.sql)
    expect(query.values).toEqual(predicate.values)
    expect(query.sql).toContain('clock_timestamp()')

    const output = await metrics.metrics()
    expect(output).toMatch(new RegExp(`${METRIC_NAMES.aiRunDue}\\{[^}]*} 2`))
  })

  it('bounds a stalled query and resets both gauges to empty, counting a collector error, on timeout', async () => {
    jest.useFakeTimers()
    const metrics = makeMetrics()
    const groupBy = jest.fn(
      (): Promise<Array<{ status: AiRunStatus; _count: number }>> => new Promise(() => undefined)
    )
    const count = jest.fn((): Promise<Array<{ count: bigint }>> => new Promise(() => undefined))
    const prisma = { aiRun: { groupBy }, $queryRaw: count } as unknown as PrismaService

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
    count.mockResolvedValue([{ count: 0n }])
    const nextScrape = await metrics.metrics()
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="ai_run_backlog"`
    )
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="ai_run_due"`
    )
  })
})
