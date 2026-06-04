import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

import { METRIC_NAMES } from './metrics.constants'

import { EnvService } from '@/env/env.service'

type HttpLabels = {
  method: string
  route: string
  status_code: string
  role: string
}

type InFlightLabels = Omit<HttpLabels, 'status_code'>

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry = new Registry()
  private readonly role: string
  private readonly httpRequestsTotal: Counter<keyof HttpLabels>
  private readonly httpRequestDurationSeconds: Histogram<keyof HttpLabels>
  private readonly httpRequestsInFlight: Gauge<keyof InFlightLabels>
  private readonly metricsCollectorErrorsTotal: Counter<'collector'>

  constructor(private readonly env: EnvService) {
    this.role = env.get('PROCESS_ROLE')
    this.registry.setDefaultLabels({
      service: 'amcore-api',
      role: this.role,
      node_env: env.get('NODE_ENV'),
    })
    // prom-client's default event-loop collector uses perf_hooks monitoring that
    // keeps Jest workers alive. Runtime environments still export defaults.
    if (env.get('NODE_ENV') !== 'test') {
      collectDefaultMetrics({ register: this.registry })
    }

    this.httpRequestsTotal = this.getOrCreateCounter(METRIC_NAMES.httpRequestsTotal, {
      help: 'Total HTTP requests by method, normalized route, status code, and process role.',
      labelNames: ['method', 'route', 'status_code', 'role'],
    })
    this.httpRequestDurationSeconds = this.getOrCreateHistogram(
      METRIC_NAMES.httpRequestDurationSeconds,
      {
        help: 'HTTP request duration in seconds by method, normalized route, status code, and process role.',
        labelNames: ['method', 'route', 'status_code', 'role'],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      }
    )
    this.httpRequestsInFlight = this.getOrCreateGauge(METRIC_NAMES.httpRequestsInFlight, {
      help: 'In-flight HTTP requests by method, normalized route, and process role.',
      labelNames: ['method', 'route', 'role'],
    })
    this.metricsCollectorErrorsTotal = this.getOrCreateCounter(
      METRIC_NAMES.metricsCollectorErrorsTotal,
      {
        help: 'Total metrics collector errors or timeouts by collector name.',
        labelNames: ['collector'],
      }
    )
  }

  get enabled(): boolean {
    return this.env.get('METRICS_ENABLED')
  }

  get contentType(): string {
    return this.registry.contentType
  }

  async metrics(): Promise<string> {
    return this.registry.metrics()
  }

  incHttpInFlight(labels: InFlightLabels): void {
    if (!this.enabled) return
    this.httpRequestsInFlight.inc(labels)
  }

  decHttpInFlight(labels: InFlightLabels): void {
    if (!this.enabled) return
    this.httpRequestsInFlight.dec(labels)
  }

  observeHttpRequest(labels: Omit<HttpLabels, 'role'>, durationSeconds: number): void {
    if (!this.enabled) return
    const allLabels = { ...labels, role: this.role }
    this.httpRequestsTotal.inc(allLabels)
    this.httpRequestDurationSeconds.observe(allLabels, durationSeconds)
  }

  inFlightLabels(method: string, route: string): InFlightLabels {
    return { method, route, role: this.role }
  }

  incCollectorError(collector: string): void {
    if (!this.enabled) return
    this.metricsCollectorErrorsTotal.inc({ collector })
  }

  onModuleDestroy(): void {
    this.registry.clear()
  }

  private getOrCreateCounter<T extends string>(
    name: string,
    config: { help: string; labelNames: T[] }
  ): Counter<T> {
    const existing = this.registry.getSingleMetric(name)
    if (existing) return existing as Counter<T>
    return new Counter<T>({
      name,
      help: config.help,
      labelNames: config.labelNames,
      registers: [this.registry],
    })
  }

  private getOrCreateGauge<T extends string>(
    name: string,
    config: { help: string; labelNames: T[] }
  ): Gauge<T> {
    const existing = this.registry.getSingleMetric(name)
    if (existing) return existing as Gauge<T>
    return new Gauge<T>({
      name,
      help: config.help,
      labelNames: config.labelNames,
      registers: [this.registry],
    })
  }

  private getOrCreateHistogram<T extends string>(
    name: string,
    config: { help: string; labelNames: T[]; buckets: number[] }
  ): Histogram<T> {
    const existing = this.registry.getSingleMetric(name)
    if (existing) return existing as Histogram<T>
    return new Histogram<T>({
      name,
      help: config.help,
      labelNames: config.labelNames,
      buckets: config.buckets,
      registers: [this.registry],
    })
  }
}
