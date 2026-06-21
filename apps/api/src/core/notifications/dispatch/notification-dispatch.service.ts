import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../../prisma'
import { ChannelDelivererRegistry } from '../channels/channel-deliverer.registry'
import type { DeliveryResult } from '../channels/channel-deliverer.types'
import type { NotificationChannel } from '../notification.constants'
import {
  NOTIFICATION_CLAIM_BATCH_LIMIT,
  NOTIFICATION_MAX_DRAIN_CYCLES,
  NOTIFICATION_PROVIDER_TIMEOUT_MS,
  NotificationErrorCode,
} from '../notification-dispatch.constants'

import { NotificationDeliveryRepository } from './notification-delivery.repository'
import type { ClaimedDelivery, FinalizeResult } from './notification-dispatch.types'

import { MetricsService } from '@/infrastructure/observability'
import { QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * Drains due notification deliveries (ADR-052). Invoked by both the BullMQ wake job and
 * the recovery `@Cron`; both are safe to run concurrently because every claim uses
 * `FOR UPDATE SKIP LOCKED`. Performs the only provider I/O in the subsystem — between the
 * repository's claim and finalize — bounded by a per-attempt timeout. Postgres owns the
 * retry schedule and attempt history; this service maps a provider result to a transition.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotificationDeliveryRepository,
    private readonly deliverers: ChannelDelivererRegistry,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationDispatchService.name)
  }

  /** Reclaim expired leases, then drain due deliveries until the backlog is clear. */
  async runDispatchCycle(): Promise<void> {
    await this.reapExpiredLeases()
    await this.drainDueBatches()
  }

  /** Reclaim crashed/stalled (`PROCESSING`, lease expired) deliveries. */
  async reapExpiredLeases(): Promise<void> {
    const { rescheduled, deadLettered } = await this.repository.reapExpiredLeases()
    this.recordDeadLetters(deadLettered)
    if (rescheduled > 0 || deadLettered > 0) {
      this.logger.warn(
        { event: 'notification.lease_reaped', rescheduled, deadLettered },
        'Reclaimed expired notification delivery leases'
      )
    }
  }

  /** Claim + process due deliveries in bounded batches until a short batch (or the cap). */
  async drainDueBatches(): Promise<void> {
    for (let cycle = 0; cycle < NOTIFICATION_MAX_DRAIN_CYCLES; cycle += 1) {
      const claimed = await this.repository.claimDueBatch()
      if (claimed.length === 0) return
      for (const delivery of claimed) {
        await this.processClaim(delivery)
      }
      if (claimed.length < NOTIFICATION_CLAIM_BATCH_LIMIT) return
    }
  }

  private async processClaim(claim: ClaimedDelivery): Promise<void> {
    const deliverer = this.deliverers.get(claim.channel as NotificationChannel)
    if (!deliverer) {
      // No adapter for this channel — terminal, not retried (defensive; producer keeps
      // target-resolver/deliverer parity so this should not happen in practice).
      await this.finalizeAndObserve(claim, () =>
        this.repository.finalizePermanent(claim, NotificationErrorCode.NO_ADAPTER, 0)
      )
      this.logger.error(
        { event: 'notification.no_adapter', deliveryId: claim.id, channel: claim.channel },
        'No deliverer registered for notification channel'
      )
      return
    }

    const notification = await this.prisma.notification.findUnique({
      where: { id: claim.notificationId },
    })
    if (!notification) {
      // Notification vanished (e.g. recipient hard-deleted) — nothing to deliver.
      await this.finalizeAndObserve(claim, () =>
        this.repository.finalizePermanent(claim, NotificationErrorCode.NOTIFICATION_MISSING, 0)
      )
      return
    }

    const startedAt = performance.now()
    let result: DeliveryResult
    try {
      result = await this.deliverWithTimeout(() =>
        deliverer.deliver({ delivery: claim, notification })
      )
    } catch (err) {
      // A thrown error is transient by default (network/unknown) — bounded by maxAttempts.
      result = { status: 'transient', errorCode: NotificationErrorCode.PROVIDER_ERROR }
      this.logger.warn(
        {
          event: 'notification.deliver_threw',
          deliveryId: claim.id,
          channel: claim.channel,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Notification deliverer threw — treating as transient'
      )
    }
    const durationMs = Math.round(performance.now() - startedAt)

    await this.finalizeAndObserve(claim, () => this.applyResult(claim, result, durationMs))
  }

  private applyResult(
    claim: ClaimedDelivery,
    result: DeliveryResult,
    durationMs: number
  ): Promise<FinalizeResult> {
    switch (result.status) {
      case 'delivered':
        return this.repository.finalizeDelivered(claim, result.providerMessageId, durationMs)
      case 'transient':
        return this.repository.finalizeTransient(
          claim,
          result.errorCode,
          durationMs,
          result.retryAfterMs
        )
      case 'permanent':
        return this.repository.finalizePermanent(claim, result.errorCode, durationMs)
    }
  }

  /** Run a finalize and emit a single dead-letter signal if it ended terminally failed. */
  private async finalizeAndObserve(
    claim: ClaimedDelivery,
    finalize: () => Promise<FinalizeResult>
  ): Promise<void> {
    const outcome = await finalize()
    if (outcome.state === 'failed' && outcome.deadLettered) {
      this.recordDeadLetters(1)
      this.logger.error(
        {
          event: 'notification.delivery.dead_letter',
          deliveryId: claim.id,
          channel: claim.channel,
          reason: outcome.reasonCode,
        },
        'Notification delivery dead-lettered (will not be retried)'
      )
    }
  }

  private async deliverWithTimeout(
    deliver: () => Promise<DeliveryResult>
  ): Promise<DeliveryResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<DeliveryResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'transient', errorCode: NotificationErrorCode.PROVIDER_TIMEOUT }),
        NOTIFICATION_PROVIDER_TIMEOUT_MS
      )
    })
    try {
      return await Promise.race([deliver(), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private recordDeadLetters(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.metrics.incQueueEvent(QueueName.NOTIFICATIONS, 'dead_letter')
    }
  }
}
