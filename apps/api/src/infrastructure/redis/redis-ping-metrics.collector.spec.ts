import type { RedisConnectionService } from './redis-connection.service'
import { RedisPingMetricsCollector } from './redis-ping-metrics.collector'

import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'

describe('RedisPingMetricsCollector', () => {
  const services: MetricsService[] = []

  function makeMetrics(): MetricsService {
    const env = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PROCESS_ROLE: 'web',
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

  it('exposes a non-negative round-trip latency gauge with no declared labels', async () => {
    const metrics = makeMetrics()
    const redis = {
      client: { ping: jest.fn().mockResolvedValue('PONG') },
    } as unknown as RedisConnectionService

    new RedisPingMetricsCollector(metrics, redis)

    const output = await metrics.metrics()
    const line = output.split('\n').find((l) => l.startsWith(`${METRIC_NAMES.redisPingSeconds}{`))
    expect(line).toBeDefined()
    const value = Number(line?.split(' ').pop())
    expect(value).toBeGreaterThanOrEqual(0)
  })

  it('bounds a stalled PING and resets the gauge to empty, counting a collector error, on timeout', async () => {
    jest.useFakeTimers()
    const metrics = makeMetrics()
    const ping = jest.fn((): Promise<string> => new Promise(() => undefined))
    const redis = { client: { ping } } as unknown as RedisConnectionService

    new RedisPingMetricsCollector(metrics, redis)

    const pending = metrics.metrics()
    await jest.advanceTimersByTimeAsync(150)
    const failedScrape = await pending

    // A zero-label gauge does not disappear on reset() the way a labeled one
    // does (prom-client keeps an implicit default series for it) — it reads
    // back as 0, not absent (see redis-ping-metrics.collector.ts).
    expect(failedScrape).toMatch(new RegExp(`${METRIC_NAMES.redisPingSeconds}\\{[^}]*} 0`))

    // The collector-error counter is incremented mid-scrape by this
    // gauge's own collect(), *after* the counter's own exposition text was
    // already serialized (registration order) — so it only shows up on the
    // *next* scrape, matching queue-depth-metrics.collector.spec.ts's
    // established pattern for this exact timing. Let the next PING resolve
    // so the next scrape doesn't itself stall.
    ping.mockResolvedValue('PONG')
    const nextScrape = await metrics.metrics()
    expect(nextScrape).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="redis_ping"`
    )
  })
})
