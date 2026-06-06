import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client'

import { METRIC_NAMES, METRICS_COLLECTOR_TIMEOUT_MS } from './metrics.constants'

import { EnvService } from '@/env/env.service'

type HttpLabels = {
  method: string
  route: string
  status_code: string
  role: string
}

type InFlightLabels = Omit<HttpLabels, 'status_code'>

type GaugeHandle<T extends string> = Pick<Gauge<T>, 'reset' | 'set'>

export type RedisMetricsClient = 'shared' | 'queue_producer' | 'queue_worker' | 'throttler'
export type RedisMetricsEvent = 'error' | 'reconnecting' | 'degraded'
export type QueueMetricsEvent =
  | 'job_added'
  | 'redis_error'
  | 'redis_reconnecting'
  | 'worker_error'
  | 'dead_letter'
export type QueueMetricsQueue = 'default' | 'email'
export type CacheMetricsCache = 'user' | 'permissions'
export type CacheMetricsResult = 'hit' | 'negative_hit' | 'miss' | 'db_fallback' | 'corrupt'
export type StorageMetricsDriver = 's3' | 'local' | 'memory'
export type StorageMetricsOperation =
  | 'upload'
  | 'download'
  | 'download_stream'
  | 'get_metadata'
  | 'delete'
  | 'delete_many'
  | 'exists'
  | 'list'
  | 'copy'
  | 'move'
  | 'signed_download_url'
  | 'signed_upload_url'
export type MediaMetricsPreset = 'avatar'
export type MediaMetricsOperation = 'process' | 'delete_derivatives'
export type EmailMetricsTemplate =
  | 'welcome'
  | 'password-reset'
  | 'email-verification'
  | 'password-changed'
  | 'org-invite'
  | 'unknown'
export type EmailMetricsOperation = 'dispatch' | 'render' | 'send' | 'process'
export type EmailMetricsMode = 'queued' | 'direct' | 'worker'
export type MetricsResult = 'success' | 'error'
export type EmailMetricsResult = MetricsResult | 'discarded'
export type EmailMetricsRetryable = 'true' | 'false' | 'unknown'

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry = new Registry()
  private readonly role: string
  private readonly httpRequestsTotal: Counter<keyof HttpLabels>
  private readonly httpRequestDurationSeconds: Histogram<keyof HttpLabels>
  private readonly httpRequestsInFlight: Gauge<keyof InFlightLabels>
  private readonly metricsCollectorErrorsTotal: Counter<'collector'>
  private readonly dbSlowQueriesTotal: Counter<'role'>
  private readonly redisClientEventsTotal: Counter<'client' | 'event' | 'role'>
  private readonly queueEventsTotal: Counter<'queue' | 'event' | 'role'>
  private readonly cacheOperationsTotal: Counter<'cache' | 'result' | 'role'>
  private readonly storageOperationsTotal: Counter<'driver' | 'operation' | 'result' | 'role'>
  private readonly storageOperationDurationSeconds: Histogram<
    'driver' | 'operation' | 'result' | 'role'
  >
  private readonly mediaOperationsTotal: Counter<'preset' | 'operation' | 'result' | 'role'>
  private readonly mediaOperationDurationSeconds: Histogram<
    'preset' | 'operation' | 'result' | 'role'
  >
  private readonly emailOperationsTotal: Counter<
    'template' | 'operation' | 'mode' | 'result' | 'retryable' | 'role'
  >
  private readonly emailOperationDurationSeconds: Histogram<
    'template' | 'operation' | 'mode' | 'result' | 'role'
  >
  private readonly emailDeadLettersTotal: Counter<'template' | 'unrecoverable' | 'role'>

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
    this.dbSlowQueriesTotal = this.getOrCreateCounter(METRIC_NAMES.dbSlowQueriesTotal, {
      help: 'Total slow database queries by process role.',
      labelNames: ['role'],
    })
    this.redisClientEventsTotal = this.getOrCreateCounter(METRIC_NAMES.redisClientEventsTotal, {
      help: 'Total Redis client events by bounded client, event, and process role.',
      labelNames: ['client', 'event', 'role'],
    })
    this.queueEventsTotal = this.getOrCreateCounter(METRIC_NAMES.queueEventsTotal, {
      help: 'Total queue events by bounded queue, event, and process role.',
      labelNames: ['queue', 'event', 'role'],
    })
    this.cacheOperationsTotal = this.getOrCreateCounter(METRIC_NAMES.cacheOperationsTotal, {
      help: 'Total cache operations by bounded cache, result, and process role.',
      labelNames: ['cache', 'result', 'role'],
    })
    this.storageOperationsTotal = this.getOrCreateCounter(METRIC_NAMES.storageOperationsTotal, {
      help: 'Total storage operations by driver, operation, result, and process role.',
      labelNames: ['driver', 'operation', 'result', 'role'],
    })
    this.storageOperationDurationSeconds = this.getOrCreateHistogram(
      METRIC_NAMES.storageOperationDurationSeconds,
      {
        help: 'Storage operation duration in seconds by driver, operation, result, and process role.',
        labelNames: ['driver', 'operation', 'result', 'role'],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      }
    )
    this.mediaOperationsTotal = this.getOrCreateCounter(METRIC_NAMES.mediaOperationsTotal, {
      help: 'Total media operations by preset, operation, result, and process role.',
      labelNames: ['preset', 'operation', 'result', 'role'],
    })
    this.mediaOperationDurationSeconds = this.getOrCreateHistogram(
      METRIC_NAMES.mediaOperationDurationSeconds,
      {
        help: 'Media operation duration in seconds by preset, operation, result, and process role.',
        labelNames: ['preset', 'operation', 'result', 'role'],
        buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      }
    )
    this.emailOperationsTotal = this.getOrCreateCounter(METRIC_NAMES.emailOperationsTotal, {
      help: 'Total email operations by template, phase, delivery mode, result, retryability, and process role.',
      labelNames: ['template', 'operation', 'mode', 'result', 'retryable', 'role'],
    })
    this.emailOperationDurationSeconds = this.getOrCreateHistogram(
      METRIC_NAMES.emailOperationDurationSeconds,
      {
        help: 'Email operation duration in seconds by template, phase, delivery mode, result, and process role.',
        labelNames: ['template', 'operation', 'mode', 'result', 'role'],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      }
    )
    this.emailDeadLettersTotal = this.getOrCreateCounter(METRIC_NAMES.emailDeadLettersTotal, {
      help: 'Total terminal email dead letters by template, unrecoverable classification, and process role.',
      labelNames: ['template', 'unrecoverable', 'role'],
    })
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

  incDbSlowQuery(): void {
    if (!this.enabled) return
    this.dbSlowQueriesTotal.inc({ role: this.role })
  }

  incRedisClientEvent(client: RedisMetricsClient, event: RedisMetricsEvent): void {
    if (!this.enabled) return
    this.redisClientEventsTotal.inc({ client, event, role: this.role })
  }

  incQueueEvent(queue: QueueMetricsQueue, event: QueueMetricsEvent): void {
    if (!this.enabled) return
    this.queueEventsTotal.inc({ queue, event, role: this.role })
  }

  incCacheOperation(cache: CacheMetricsCache, result: CacheMetricsResult): void {
    if (!this.enabled) return
    this.cacheOperationsTotal.inc({ cache, result, role: this.role })
  }

  observeStorageOperation(
    driver: StorageMetricsDriver,
    operation: StorageMetricsOperation,
    result: MetricsResult,
    durationSeconds: number
  ): void {
    if (!this.enabled) return
    const labels = { driver, operation, result, role: this.role }
    this.storageOperationsTotal.inc(labels)
    this.storageOperationDurationSeconds.observe(labels, durationSeconds)
  }

  observeMediaOperation(
    preset: MediaMetricsPreset,
    operation: MediaMetricsOperation,
    result: MetricsResult,
    durationSeconds: number
  ): void {
    if (!this.enabled) return
    const labels = { preset, operation, result, role: this.role }
    this.mediaOperationsTotal.inc(labels)
    this.mediaOperationDurationSeconds.observe(labels, durationSeconds)
  }

  observeEmailOperation(
    labels: {
      template: EmailMetricsTemplate
      operation: EmailMetricsOperation
      mode: EmailMetricsMode
      result: EmailMetricsResult
      retryable: EmailMetricsRetryable
    },
    durationSeconds: number
  ): void {
    if (!this.enabled) return
    const allLabels = { ...labels, role: this.role }
    this.emailOperationsTotal.inc(allLabels)
    this.emailOperationDurationSeconds.observe(
      {
        template: labels.template,
        operation: labels.operation,
        mode: labels.mode,
        result: labels.result,
        role: this.role,
      },
      durationSeconds
    )
  }

  incEmailDeadLetter(template: EmailMetricsTemplate, unrecoverable: boolean): void {
    if (!this.enabled) return
    this.emailDeadLettersTotal.inc({
      template,
      unrecoverable: String(unrecoverable),
      role: this.role,
    })
  }

  registerGauge<T extends string>(config: {
    name: string
    help: string
    labelNames: T[]
    collect: (gauge: GaugeHandle<T>) => void | Promise<void>
  }): void {
    // Registration is intentionally first-wins. Reusing a metric name returns
    // the existing gauge and keeps its original collect callback.
    this.getOrCreateGauge(config.name, {
      help: config.help,
      labelNames: config.labelNames,
      collect: function () {
        return config.collect(this)
      },
    })
  }

  async withCollectorTimeout<T>(collector: string, operation: Promise<T>, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`metrics collector "${collector}" timed out`)),
        METRICS_COLLECTOR_TIMEOUT_MS
      )
    })

    try {
      return await Promise.race([operation, timeout])
    } catch {
      this.incCollectorError(collector)
      return fallback
    } finally {
      clearTimeout(timer)
    }
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
    config: {
      help: string
      labelNames: T[]
      collect?: (this: Gauge<T>) => void | Promise<void>
    }
  ): Gauge<T> {
    const existing = this.registry.getSingleMetric(name)
    if (existing) return existing as Gauge<T>
    return new Gauge<T>({
      name,
      help: config.help,
      labelNames: config.labelNames,
      registers: [this.registry],
      collect: config.collect,
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
