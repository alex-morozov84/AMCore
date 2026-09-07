import { Injectable } from '@nestjs/common'

import { RedisConnectionService } from './redis-connection.service'

import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'

/**
 * Scrape-time `PING` round-trip latency against the shared `@redis/client`
 * connection — a cheap interim Redis-latency signal. `ioredis`'s low-level
 * `monitor()` stream is the only built-in per-command hook available in this
 * stack, but it covers only the `queue_producer`/`queue_worker` clients
 * BullMQ requires it for, not the shared `@redis/client` connection this
 * measures; wiring a real per-command histogram there is a separate, larger
 * follow-up.
 */
@Injectable()
export class RedisPingMetricsCollector {
  constructor(metrics: MetricsService, redis: RedisConnectionService) {
    metrics.registerGauge<never>({
      name: METRIC_NAMES.redisPingSeconds,
      help: 'Round-trip latency in seconds of a PING against the shared Redis client, sampled at scrape time.',
      labelNames: [],
      collect: async (gauge) => {
        const seconds = await metrics.withCollectorTimeout<number | null>(
          'redis_ping',
          this.measure(redis),
          null
        )

        // Unlike a labeled gauge, reset() on a zero-label one does not make
        // it vanish from the scrape (prom-client keeps an implicit default
        // series) — a timeout reads back as a visible 0, not absence. Alert
        // on amcore_metrics_collector_errors_total{collector="redis_ping"}
        // to tell "timed out" apart from "genuinely 0".
        gauge.reset()
        if (seconds === null) return
        gauge.set(seconds)
      },
    })
  }

  private async measure(redis: RedisConnectionService): Promise<number> {
    const startedAt = process.hrtime.bigint()
    await redis.client.ping()
    return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
  }
}
