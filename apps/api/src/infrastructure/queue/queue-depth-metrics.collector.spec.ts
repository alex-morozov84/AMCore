import type { Queue } from 'bullmq'

import { QueueName } from './constants/queues.constant'
import type { QueueService } from './queue.service'
import { QueueDepthMetricsCollector } from './queue-depth-metrics.collector'

import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'

describe('QueueDepthMetricsCollector', () => {
  const services: MetricsService[] = []

  function makeMetrics(): MetricsService {
    const env = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PROCESS_ROLE: 'worker',
          NODE_ENV: 'test',
          METRICS_ENABLED: true,
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

  it('exports bounded queue states and normalizes waiting-children', async () => {
    const metrics = makeMetrics()
    const queues = new Map<QueueName, Pick<Queue, 'getJobCounts'>>([
      [
        QueueName.DEFAULT,
        {
          getJobCounts: jest.fn().mockResolvedValue({
            waiting: 2,
            active: 1,
            'waiting-children': 3,
          }),
        },
      ],
      [
        QueueName.EMAIL,
        {
          getJobCounts: jest.fn().mockResolvedValue({
            completed: 5,
            failed: 1,
          }),
        },
      ],
      [
        QueueName.NOTIFICATIONS,
        {
          getJobCounts: jest.fn().mockResolvedValue({
            waiting: 1,
          }),
        },
      ],
    ])
    const queueService = {
      getQueue: jest.fn((name: QueueName) => queues.get(name)),
    } as unknown as QueueService

    new QueueDepthMetricsCollector(metrics, queueService)

    const output = await metrics.metrics()
    expect(output).toContain(`${METRIC_NAMES.queueJobs}{queue="default",state="waiting"`)
    expect(output).toContain('queue="default",state="waiting_children"')
    expect(output).toContain('queue="email",state="completed"')
    expect(output).not.toContain('state="waiting-children"')
  })

  it('bounds stalled BullMQ calls and exposes a collector error without stale gauges', async () => {
    jest.useFakeTimers()
    const metrics = makeMetrics()
    const getJobCounts = jest.fn(() => new Promise<Record<string, number>>(() => undefined))
    const queueService = {
      getQueue: jest.fn(() => ({
        getJobCounts,
      })),
    } as unknown as QueueService

    new QueueDepthMetricsCollector(metrics, queueService)

    const pending = metrics.metrics()
    await jest.advanceTimersByTimeAsync(150)
    const failedScrape = await pending

    expect(failedScrape).not.toContain(`${METRIC_NAMES.queueJobs}{`)

    getJobCounts.mockResolvedValue({})
    const nextScrape = await metrics.metrics()
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="queue_depth"`
    )
  })
})
