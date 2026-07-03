import { randomUUID } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { AiRunSseReason, AiRunStatusValue } from '@amcore/shared'

import { composeAiRunRealtimeChannel } from './ai-run-realtime.constants'
import type { AiRunRealtimeEnvelope } from './ai-run-realtime.schema'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '@/infrastructure/redis'

/**
 * Publishes the disposable AI run-status hint (Track C — ADR-054, Arc C.5; ADR-053 pattern) to the
 * environment/version-namespaced Redis Pub/Sub channel. Lives in core so any role can publish on the
 * shared client — in Arc C.5 the **worker** publishes on each run-status transition, and the
 * **web** subscriber fans it out to open streams.
 *
 * **Best-effort and fire-and-forget.** Callers invoke `void publish(...)` and never await it in an
 * execution path — a durable run transition must not wait on (or fail with) Redis. The client
 * repairs any missed hint by refetching run status; Postgres is the recovery path.
 *
 * The envelope is **content-free**: it carries only the run id, the new status, the reason, a
 * disposable event id, and the routing `recipientUserId` (trusted-Redis metadata). No prompt,
 * response, provider body, model slug, or credential is ever published.
 *
 * Two bounds keep a degraded Redis from accumulating work: `commandOptions.timeout` caps how long a
 * publish may sit in the offline queue, and an in-flight counter drops new hints once
 * `AI_REALTIME_MAX_INFLIGHT_PUBLISH` publishes are unsettled (a written command can stay pending on
 * a half-open socket, which the timeout does not bound).
 */
@Injectable()
export class AiRunRealtimePublisher {
  private readonly channel: string
  private readonly timeoutMs: number
  private readonly maxInFlight: number
  private inFlight = 0

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunRealtimePublisher.name)
    this.channel = composeAiRunRealtimeChannel(
      this.env.get('NODE_ENV'),
      this.env.get('AI_REALTIME_NAMESPACE')
    )
    this.timeoutMs = this.env.get('AI_REALTIME_PUBLISH_TIMEOUT_MS')
    this.maxInFlight = this.env.get('AI_REALTIME_MAX_INFLIGHT_PUBLISH')
  }

  async publish(
    recipientUserId: string,
    runId: string,
    status: AiRunStatusValue,
    reason: AiRunSseReason
  ): Promise<void> {
    if (this.inFlight >= this.maxInFlight) {
      this.metrics.incAiRunRealtimePublish('dropped')
      return
    }

    const envelope: AiRunRealtimeEnvelope = {
      v: 1,
      recipientUserId,
      eventId: randomUUID(),
      runId,
      status,
      reason,
    }

    this.inFlight += 1
    try {
      await this.redis
        .withCommandOptions({ timeout: this.timeoutMs })
        .publish(this.channel, JSON.stringify(envelope))
      this.metrics.incAiRunRealtimePublish('published')
    } catch (err) {
      this.metrics.incAiRunRealtimePublish('failed')
      this.logger.warn(
        {
          event: 'ai.run.realtime_publish_failed',
          reason,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Best-effort AI run realtime publish failed (client recovers on next refetch)'
      )
    } finally {
      this.inFlight -= 1
    }
  }
}
