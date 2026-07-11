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

export type RedisMetricsClient =
  | 'shared'
  | 'queue_producer'
  | 'queue_worker'
  | 'throttler'
  | 'notif_subscriber'
  | 'ai_run_subscriber'
export type RedisMetricsEvent = 'error' | 'reconnecting' | 'degraded'

/** Outcome of a best-effort realtime publish (ADR-053). */
export type NotificationRealtimePublishOutcome = 'published' | 'failed' | 'dropped'

/** Bounded realtime SSE stream/subscriber event (ADR-053). */
export type NotificationRealtimeStreamEvent =
  | 'received'
  | 'routed'
  | 'no_local_target'
  | 'invalid_envelope'
  | 'rejected_global'
  | 'rejected_user'
  | 'slow_close'
  | 'startup_failure'

/** Outcome of a best-effort AI run-status realtime publish (Track C — ADR-054, Arc C.5). */
export type AiRunRealtimePublishOutcome = 'published' | 'failed' | 'dropped'

/** Bounded AI run-status realtime SSE stream/subscriber event (Track C — ADR-054, Arc C.5). */
export type AiRunRealtimeStreamEvent =
  | 'received'
  | 'routed'
  | 'no_local_target'
  | 'invalid_envelope'
  | 'rejected_global'
  | 'rejected_user'
  | 'slow_close'
  | 'startup_failure'
export type QueueMetricsEvent =
  | 'job_added'
  | 'redis_error'
  | 'redis_reconnecting'
  | 'worker_error'
  | 'dead_letter'
export type QueueMetricsQueue = 'default' | 'email' | 'notifications' | 'ai-runs'
export type CacheMetricsCache = 'user' | 'permissions' | 'ai_catalog'
export type AiMetricsProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'openai_compatible'
  | 'yandex_ai_studio'
  | 'mock'
export type AiMetricsOperation = 'text' | 'object'
export type AiMetricsTokenDirection = 'input' | 'output'
export type AiMetricsGuardrailStage = 'input' | 'output'
export type AiMetricsGuardrailVerdict = 'allow' | 'flag' | 'block'

/** Tool risk class (lowercase wire form) — a bounded label for tool-invocation metrics (Arc E). */
export type AiMetricsToolRiskClass = 'safe' | 'sensitive' | 'destructive'
/** Terminal outcome of one tool invocation (Arc E). */
export type AiMetricsToolOutcome = 'succeeded' | 'failed' | 'rejected' | 'skipped'
/** Approval kind (lowercase projection of `AiApprovalKind`) (Arc E). */
export type AiMetricsApprovalKind = 'tool_invocation' | 'handoff' | 'sensitive_action'
/** Approval lifecycle state (lowercase projection of `AiApprovalState`) (Arc E). */
export type AiMetricsApprovalState = 'pending' | 'approved' | 'rejected' | 'expired'
/** Terminal outcome of a bounded agent loop, for the loop-steps histogram (Arc E). */
export type AiMetricsToolLoopOutcome = 'completed' | 'exhausted' | 'failed'
export type AiMetricsAssistantAdminAction =
  | 'created'
  | 'version_published'
  | 'updated'
  | 'enabled'
  | 'disabled'

/**
 * Defensive bound on the `tool_id` metric label — mirrors the code-owned tool-id grammar (Arc E).
 * Callers pass registered ids, but an out-of-grammar/overlong value is coerced to `unknown` so a
 * malformed id can never explode the label cardinality.
 */
const AI_TOOL_ID_LABEL_PATTERN = /^[a-z][a-z0-9_]*$/
const AI_TOOL_ID_LABEL_MAX_LENGTH = 48
const AI_TOOL_ID_LABEL_FALLBACK = 'unknown'
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
  | 'org-invite'
  | 'notification'
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
  private readonly notificationRealtimePublishTotal: Counter<'outcome' | 'role'>
  private readonly notificationRealtimeConnections: Gauge<'role'>
  private readonly notificationRealtimeEventsTotal: Counter<'event' | 'role'>
  private readonly aiGenerationsTotal: Counter<'provider' | 'operation' | 'result' | 'role'>
  private readonly aiTokensTotal: Counter<'provider' | 'direction' | 'role'>
  private readonly aiGuardrailChecksTotal: Counter<'stage' | 'verdict' | 'role'>
  private readonly aiRunRealtimePublishTotal: Counter<'outcome' | 'role'>
  private readonly aiRunRealtimeConnections: Gauge<'role'>
  private readonly aiRunRealtimeEventsTotal: Counter<'event' | 'role'>
  private readonly aiToolInvocationsTotal: Counter<'tool_id' | 'risk_class' | 'outcome' | 'role'>
  private readonly aiApprovalsTotal: Counter<'kind' | 'state' | 'role'>
  private readonly aiToolLoopSteps: Histogram<'outcome' | 'role'>
  private readonly aiAssistantAdminTotal: Counter<'action' | 'role'>

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
    this.notificationRealtimePublishTotal = this.getOrCreateCounter(
      METRIC_NAMES.notificationRealtimePublishTotal,
      {
        help: 'Total realtime notification publishes by outcome (published/failed/dropped) and process role.',
        labelNames: ['outcome', 'role'],
      }
    )
    this.notificationRealtimeConnections = this.getOrCreateGauge(
      METRIC_NAMES.notificationRealtimeConnections,
      {
        help: 'Currently open realtime notification SSE streams on this process, by role.',
        labelNames: ['role'],
      }
    )
    this.notificationRealtimeEventsTotal = this.getOrCreateCounter(
      METRIC_NAMES.notificationRealtimeEventsTotal,
      {
        help: 'Total realtime notification stream/subscriber events by bounded event and process role.',
        labelNames: ['event', 'role'],
      }
    )
    this.aiGenerationsTotal = this.getOrCreateCounter(METRIC_NAMES.aiGenerationsTotal, {
      help: 'Total AI generations by provider type, operation, result, and process role. No prompt/response content is ever a label.',
      labelNames: ['provider', 'operation', 'result', 'role'],
    })
    this.aiTokensTotal = this.getOrCreateCounter(METRIC_NAMES.aiTokensTotal, {
      help: 'Total AI tokens by provider type, direction (input/output), and process role.',
      labelNames: ['provider', 'direction', 'role'],
    })
    this.aiGuardrailChecksTotal = this.getOrCreateCounter(METRIC_NAMES.aiGuardrailChecksTotal, {
      help: 'Total AI guardrail checks by stage (input/output), verdict (allow/flag/block), and process role. No prompt/output content, marker, or category value is ever a label.',
      labelNames: ['stage', 'verdict', 'role'],
    })
    this.aiRunRealtimePublishTotal = this.getOrCreateCounter(
      METRIC_NAMES.aiRunRealtimePublishTotal,
      {
        help: 'Total AI run-status realtime publishes by outcome (published/failed/dropped) and process role.',
        labelNames: ['outcome', 'role'],
      }
    )
    this.aiRunRealtimeConnections = this.getOrCreateGauge(METRIC_NAMES.aiRunRealtimeConnections, {
      help: 'Currently open AI run-status SSE streams on this process, by role.',
      labelNames: ['role'],
    })
    this.aiRunRealtimeEventsTotal = this.getOrCreateCounter(METRIC_NAMES.aiRunRealtimeEventsTotal, {
      help: 'Total AI run-status realtime stream/subscriber events by bounded event and process role.',
      labelNames: ['event', 'role'],
    })
    this.aiToolInvocationsTotal = this.getOrCreateCounter(METRIC_NAMES.aiToolInvocationsTotal, {
      help: 'Total AI tool invocations by code-owned tool id, risk class, and outcome (+ process role). tool_id is bounded to the code-owned registry; no args, result, or prompt is ever a label.',
      labelNames: ['tool_id', 'risk_class', 'outcome', 'role'],
    })
    this.aiApprovalsTotal = this.getOrCreateCounter(METRIC_NAMES.aiApprovalsTotal, {
      help: 'Total AI human-in-the-loop approvals by kind and state (+ process role). No approval/run/user id or reason text is ever a label.',
      labelNames: ['kind', 'state', 'role'],
    })
    this.aiToolLoopSteps = this.getOrCreateHistogram(METRIC_NAMES.aiToolLoopSteps, {
      help: 'Distribution of bounded agent-loop steps per finished AI run by terminal outcome (+ process role).',
      labelNames: ['outcome', 'role'],
      buckets: [1, 2, 3, 4, 6, 8, 12, 16],
    })
    this.aiAssistantAdminTotal = this.getOrCreateCounter(METRIC_NAMES.aiAssistantAdminTotal, {
      help: 'Total AI assistant-registry admin mutations by bounded action (+ process role). No slug, prompt, or config value is ever a label.',
      labelNames: ['action', 'role'],
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

  incNotificationRealtimePublish(outcome: NotificationRealtimePublishOutcome): void {
    if (!this.enabled) return
    this.notificationRealtimePublishTotal.inc({ outcome, role: this.role })
  }

  incNotificationRealtimeConnections(): void {
    if (!this.enabled) return
    this.notificationRealtimeConnections.inc({ role: this.role })
  }

  decNotificationRealtimeConnections(): void {
    if (!this.enabled) return
    this.notificationRealtimeConnections.dec({ role: this.role })
  }

  incNotificationRealtimeEvent(event: NotificationRealtimeStreamEvent): void {
    if (!this.enabled) return
    this.notificationRealtimeEventsTotal.inc({ event, role: this.role })
  }

  incAiRunRealtimePublish(outcome: AiRunRealtimePublishOutcome): void {
    if (!this.enabled) return
    this.aiRunRealtimePublishTotal.inc({ outcome, role: this.role })
  }

  incAiRunRealtimeConnections(): void {
    if (!this.enabled) return
    this.aiRunRealtimeConnections.inc({ role: this.role })
  }

  decAiRunRealtimeConnections(): void {
    if (!this.enabled) return
    this.aiRunRealtimeConnections.dec({ role: this.role })
  }

  incAiRunRealtimeEvent(event: AiRunRealtimeStreamEvent): void {
    if (!this.enabled) return
    this.aiRunRealtimeEventsTotal.inc({ event, role: this.role })
  }

  incQueueEvent(queue: QueueMetricsQueue, event: QueueMetricsEvent): void {
    if (!this.enabled) return
    this.queueEventsTotal.inc({ queue, event, role: this.role })
  }

  incCacheOperation(cache: CacheMetricsCache, result: CacheMetricsResult): void {
    if (!this.enabled) return
    this.cacheOperationsTotal.inc({ cache, result, role: this.role })
  }

  incAiGeneration(
    provider: AiMetricsProvider,
    operation: AiMetricsOperation,
    result: MetricsResult
  ): void {
    if (!this.enabled) return
    this.aiGenerationsTotal.inc({ provider, operation, result, role: this.role })
  }

  incAiTokens(
    provider: AiMetricsProvider,
    direction: AiMetricsTokenDirection,
    count: number
  ): void {
    if (!this.enabled || count <= 0) return
    this.aiTokensTotal.inc({ provider, direction, role: this.role }, count)
  }

  /**
   * Count one AI guardrail check (Arc D). Only the low-cardinality `stage`/`verdict` (+ process
   * role) are labels — never a prompt/output snippet, the boundary marker, or a category value.
   */
  incAiGuardrailCheck(stage: AiMetricsGuardrailStage, verdict: AiMetricsGuardrailVerdict): void {
    if (!this.enabled) return
    this.aiGuardrailChecksTotal.inc({ stage, verdict, role: this.role })
  }

  /**
   * Count one AI tool invocation (Arc E). Labels are the bounded, code-owned `tool_id`, its
   * `risk_class`, and the terminal `outcome` (+ process role) — never tool args, result, prompt, or
   * any run/user id. `tool_id` is bounded because the registry is code-owned and size-capped.
   */
  incAiToolInvocation(
    toolId: string,
    riskClass: AiMetricsToolRiskClass,
    outcome: AiMetricsToolOutcome
  ): void {
    if (!this.enabled) return
    const tool_id =
      toolId.length <= AI_TOOL_ID_LABEL_MAX_LENGTH && AI_TOOL_ID_LABEL_PATTERN.test(toolId)
        ? toolId
        : AI_TOOL_ID_LABEL_FALLBACK
    this.aiToolInvocationsTotal.inc({ tool_id, risk_class: riskClass, outcome, role: this.role })
  }

  /**
   * Count one AI human-in-the-loop approval transition (Arc E). Only the low-cardinality `kind`/
   * `state` (+ process role) are labels — never an approval/run/user id or reason text.
   */
  incAiApproval(kind: AiMetricsApprovalKind, state: AiMetricsApprovalState): void {
    if (!this.enabled) return
    this.aiApprovalsTotal.inc({ kind, state, role: this.role })
  }

  /**
   * Count one AI assistant-registry admin mutation (Arc F.1), labelled only by the bounded `action`
   * (+ process role). Never a slug, prompt, model, or config value.
   */
  incAiAssistantAdmin(action: AiMetricsAssistantAdminAction): void {
    if (!this.enabled) return
    this.aiAssistantAdminTotal.inc({ action, role: this.role })
  }

  /**
   * Record the number of bounded agent-loop steps a finished AI run took (Arc E), labelled only by
   * terminal `outcome` (+ process role). A negative count is ignored defensively.
   */
  observeAiToolLoopSteps(outcome: AiMetricsToolLoopOutcome, steps: number): void {
    if (!this.enabled || steps < 0) return
    this.aiToolLoopSteps.observe({ outcome, role: this.role }, steps)
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
