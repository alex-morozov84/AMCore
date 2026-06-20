import { randomUUID } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { NotificationSseReason } from '@amcore/shared'

import { composeRealtimeChannel } from './notification-realtime.constants'
import type { NotificationRealtimeEnvelope } from './notification-realtime.schema'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '@/infrastructure/redis'

/**
 * Publishes the disposable realtime invalidation hint (ADR-053) to the
 * environment/version-namespaced Redis Pub/Sub channel. Lives in core so any role
 * (worker producing, web mutating) can publish on the shared client.
 *
 * **Best-effort and fire-and-forget.** Callers invoke `void publish(...)` and never
 * await it in a request path — a committed notification / feed mutation must not
 * wait on (or fail with) Redis. The client repairs any missed hint on its next
 * refetch, and the worker recovery poller is the durable path for external delivery.
 *
 * Two bounds keep a degraded Redis from accumulating work: `commandOptions.timeout`
 * caps how long a publish may sit in the offline queue, and an in-flight counter
 * drops new hints once `MAX_INFLIGHT_PUBLISH` publishes are unsettled (a written
 * command can stay pending on a half-open socket, which the timeout does not bound).
 */
@Injectable()
export class NotificationRealtimePublisher {
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
    this.logger.setContext(NotificationRealtimePublisher.name)
    this.channel = composeRealtimeChannel(
      this.env.get('NODE_ENV'),
      this.env.get('NOTIFICATIONS_REALTIME_NAMESPACE')
    )
    this.timeoutMs = this.env.get('NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS')
    this.maxInFlight = this.env.get('NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH')
  }

  async publish(
    recipientUserId: string,
    reason: NotificationSseReason,
    notificationId?: string
  ): Promise<void> {
    if (this.inFlight >= this.maxInFlight) {
      this.metrics.incNotificationRealtimePublish('dropped')
      return
    }

    const envelope: NotificationRealtimeEnvelope = {
      v: 1,
      recipientUserId,
      eventId: randomUUID(),
      reason,
      ...(notificationId ? { notificationId } : {}),
    }

    this.inFlight += 1
    try {
      await this.redis
        .withCommandOptions({ timeout: this.timeoutMs })
        .publish(this.channel, JSON.stringify(envelope))
      this.metrics.incNotificationRealtimePublish('published')
    } catch (err) {
      this.metrics.incNotificationRealtimePublish('failed')
      this.logger.warn(
        {
          event: 'notification.realtime_publish_failed',
          reason,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Best-effort realtime publish failed (client recovers on next refetch)'
      )
    } finally {
      this.inFlight -= 1
    }
  }
}
