import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { NotificationSseEvent } from '@amcore/shared'

import {
  composeRealtimeChannel,
  NOTIFICATION_REALTIME_ENVELOPE_MAX_BYTES,
  NOTIFICATION_REALTIME_SHUTDOWN_DEADLINE_MS,
} from './notification-realtime.constants'
import { NotificationRealtimeHub } from './notification-realtime.hub'
import { notificationRealtimeEnvelopeSchema } from './notification-realtime.schema'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { type AppRedisClient, REDIS_CLIENT } from '@/infrastructure/redis'

/**
 * One dedicated Redis Pub/Sub subscriber per web/all process (ADR-053). RESP2 puts a
 * subscribed connection in subscriber mode (it can run no normal commands), so this
 * uses a duplicated connection; the shared client stays free for publishing/cache.
 * Every received envelope is byte-guarded, strictly parsed, and routed to the local
 * hub by `recipientUserId`. A missed message is at-most-once — the client repairs it
 * on the next reconnect/refetch — so there is no replay here.
 */
@Injectable()
export class NotificationRealtimeSubscriber implements OnModuleInit, OnModuleDestroy {
  private subscriber?: AppRedisClient
  private readonly channel: string

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
    private readonly env: EnvService,
    private readonly hub: NotificationRealtimeHub,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationRealtimeSubscriber.name)
    this.channel = composeRealtimeChannel(
      this.env.get('NODE_ENV'),
      this.env.get('NOTIFICATIONS_REALTIME_NAMESPACE')
    )
  }

  async onModuleInit(): Promise<void> {
    const subscriber = this.redis.duplicate()
    this.subscriber = subscriber
    // Attach listeners BEFORE connect: an emitted 'error' with no listener crashes
    // the process, and a Redis outage is exactly when this feature must stay up.
    subscriber.on('error', (err: unknown) => {
      this.metrics.incRedisClientEvent('notif_subscriber', 'error')
      this.logger.error({ err }, 'Notification realtime subscriber error')
    })
    subscriber.on('reconnecting', () =>
      this.metrics.incRedisClientEvent('notif_subscriber', 'reconnecting')
    )
    try {
      await subscriber.connect()
      await subscriber.subscribe(this.channel, (message: string) => this.onMessage(message))
    } catch (err) {
      // A half-open dedicated client must not leak if connect/subscribe fails.
      this.subscriber = undefined
      this.forceDestroy(subscriber)
      throw err
    }
  }

  private onMessage(message: string): void {
    if (Buffer.byteLength(message, 'utf8') > NOTIFICATION_REALTIME_ENVELOPE_MAX_BYTES) {
      this.metrics.incNotificationRealtimeEvent('invalid_envelope')
      return
    }
    const parsed = this.parse(message)
    if (!parsed) {
      this.metrics.incNotificationRealtimeEvent('invalid_envelope')
      return
    }
    this.metrics.incNotificationRealtimeEvent('received')
    const event: NotificationSseEvent = {
      eventId: parsed.eventId,
      reason: parsed.reason,
      ...(parsed.notificationId ? { notificationId: parsed.notificationId } : {}),
    }
    const delivered = this.hub.routeToUser(parsed.recipientUserId, event)
    this.metrics.incNotificationRealtimeEvent(delivered > 0 ? 'routed' : 'no_local_target')
  }

  private parse(
    message: string
  ): ReturnType<typeof notificationRealtimeEnvelopeSchema.parse> | null {
    try {
      return notificationRealtimeEnvelopeSchema.parse(JSON.parse(message))
    } catch {
      return null
    }
  }

  async onModuleDestroy(): Promise<void> {
    const subscriber = this.subscriber
    if (!subscriber) return
    this.subscriber = undefined
    if (!subscriber.isReady) return this.forceDestroy(subscriber)
    // Phase 1 — bounded unsubscribe. While it is in flight the client is still OPEN,
    // so a timeout or failure can fall back to a forceful destroy() safely.
    if (!(await this.bounded(subscriber.unsubscribe(this.channel)))) {
      return this.forceDestroy(subscriber)
    }
    // Phase 2 — the unsubscribe ACK left the command queue empty, so `close()`
    // synchronously destroys the socket and resolves (node-redis `close()` isEmpty
    // branch): no race, no hang, and no destroy()-after-close ClientClosedError.
    try {
      await subscriber.close()
    } catch {
      this.forceDestroy(subscriber)
    }
  }

  /** Best-effort forceful close; a no-op if the client is already closing/closed. */
  private forceDestroy(subscriber: AppRedisClient): void {
    try {
      subscriber.destroy()
    } catch {
      /* already closing/closed — nothing to force */
    }
  }

  /** Race an operation against the shutdown deadline; true iff it settled in time. */
  private async bounded(operation: Promise<unknown>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = operation.then(() => true).catch(() => false) // never goes unhandled
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), NOTIFICATION_REALTIME_SHUTDOWN_DEADLINE_MS)
      timer.unref?.()
    })
    try {
      return await Promise.race([settled, deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
