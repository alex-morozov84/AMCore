import { performance } from 'node:perf_hooks'

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../../prisma'
import { ChannelDelivererRegistry } from '../channels/channel-deliverer.registry'
import {
  type DeliveryResult,
  isNotStarted,
  type NotStarted,
} from '../channels/channel-deliverer.types'
import type { NotificationChannel } from '../notification.constants'
import {
  NOTIFICATION_MAX_DRAIN_DELIVERIES,
  NOTIFICATION_PROVIDER_TIMEOUT_MS,
  NOTIFICATION_SHUTDOWN_GRACE_MS,
  NotificationErrorCode,
} from '../notification-dispatch.constants'

import { NotificationAttemptAdmission } from './notification-attempt-admission'
import { NotificationDeliveryRepository } from './notification-delivery.repository'
import { NotificationDispatchGate } from './notification-dispatch.gate'
import type { ClaimedDelivery, FinalizeResult } from './notification-dispatch.types'
import { CUTOFF, NotificationShutdownLatch } from './notification-shutdown.latch'

import { MetricsService } from '@/infrastructure/observability'
import { QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { AttemptRuntime } from '@/infrastructure/worker-lifecycle'

/**
 * Drains due notification deliveries (ADR-052). Invoked by both the BullMQ wake job and the
 * recovery `@Cron`; both are safe to run concurrently because every claim uses
 * `FOR UPDATE SKIP LOCKED` AND they share one process-wide capacity gate.
 *
 * Capacity: a drain reserves "lanes" synchronously before any awaited work; each lane claims ONE
 * row, so a leased row starts immediately (the lease never ages in a batch tail), processes it,
 * and repeats. A lane's reservation is held until its physical transport call has SETTLED — a
 * timed-out call whose transport ignores abort keeps its slot, so detached provider calls never
 * exceed the cap. The slot is never released merely because finalize succeeded, failed or threw.
 *
 * Shutdown: see `NotificationShutdownLatch`. After the first `shutdown()` nothing new starts, and
 * every wait on lane work is bounded by the latch even if a DB promise or transport never settles.
 *
 * Postgres owns the retry schedule and attempt history; this service maps a provider result to a
 * transition.
 */
@Injectable()
export class NotificationDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly activeLanes = new Set<Promise<void>>()
  private shutdownPromise: Promise<void> | undefined
  /** The shutdown grace; a plain field (not a constructor parameter) so tests can shorten it. */
  shutdownGraceMs = NOTIFICATION_SHUTDOWN_GRACE_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotificationDeliveryRepository,
    private readonly deliverers: ChannelDelivererRegistry,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly latch: NotificationShutdownLatch,
    private readonly gate: NotificationDispatchGate,
    private readonly admissions: NotificationAttemptAdmission
  ) {
    this.logger.setContext(NotificationDispatchService.name)
  }

  /** Register the bounded drain so it completes BEFORE the database pool is torn down. */
  onModuleInit(): void {
    this.prisma.registerShutdownBarrier(() => this.shutdown())
  }

  /** Best-effort earlier stop of new work; the bounded wait is the registered barrier. */
  onModuleDestroy(): void {
    this.latch.close()
  }

  /**
   * Stop new work and wait — boundedly — for lane work. Idempotent: the FIRST call fixes the one
   * deadline (cached promise); repeated hooks neither restart nor extend it. The latch is sealed
   * before EVERY return (early/empty completion, grace expiry, or an unexpected error), so a late
   * transport result can never start fence/cancel/admission/DB work after the barrier returned.
   * Never throws; physical transport calls are not waited for.
   */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      this.latch.close()
      timer = setTimeout(() => this.latch.seal(), this.shutdownGraceMs)
      await Promise.allSettled([...this.activeLanes])
    } catch {
      this.logger.error(
        { event: 'notification.shutdown_failed' },
        'Notification dispatch shutdown wait failed'
      )
    } finally {
      if (timer) clearTimeout(timer)
      this.latch.seal()
    }
  }

  /** Reclaim expired leases, then drain due deliveries until the backlog is clear. */
  async runDispatchCycle(): Promise<void> {
    if (this.latch.closed) return
    await this.reapExpiredLeases()
    await this.drainDueBatches()
  }

  /** Reclaim crashed/stalled (`PROCESSING`, lease expired) deliveries. */
  async reapExpiredLeases(): Promise<void> {
    if (this.latch.closed) return
    // The repository runs its transaction through the latch; wrapping the call here as well keeps
    // the wait bounded independently of that implementation detail.
    const reaped = await this.latch.run(() => this.repository.reapExpiredLeases())
    if (reaped === CUTOFF) return
    this.recordDeadLetters(reaped.deadLettered)
    if (reaped.rescheduled > 0 || reaped.deadLettered > 0) {
      this.logger.warn(
        {
          event: 'notification.lease_reaped',
          rescheduled: reaped.rescheduled,
          deadLettered: reaped.deadLettered,
        },
        'Reclaimed expired notification delivery leases'
      )
    }
  }

  /**
   * Reserve lanes, drain due rows (one claim per lane, bounded by a shared delivery budget) and
   * resolve when lane WORK is done — never waiting for a still-pending physical call.
   */
  async drainDueBatches(): Promise<void> {
    if (this.latch.closed) return
    const granted = this.gate.reserve(this.gate.capacity)
    if (granted === 0) {
      // Full: a running lane will look once more before it exits (no lost wake).
      this.gate.requestRescan()
      return
    }
    const budget = { remaining: NOTIFICATION_MAX_DRAIN_DELIVERIES }
    await Promise.all(Array.from({ length: granted }, () => this.startLane(budget)))
  }

  private startLane(budget: { remaining: number }): Promise<void> {
    const work = this.runLane(budget)
    this.activeLanes.add(work)
    void work.finally(() => this.activeLanes.delete(work))
    return work
  }

  /** One lane: owns one gate reservation. Never rejects. */
  private async runLane(budget: { remaining: number }): Promise<void> {
    let released = false
    let handedOff = false
    const release = (): void => {
      if (released) return
      released = true
      try {
        this.gate.release(1)
      } catch {
        /* a release failure must never escape a settlement callback */
      }
    }
    try {
      while (!this.latch.closed && budget.remaining > 0) {
        budget.remaining -= 1
        const claimed = await this.latch.run(() => this.repository.claimDueBatch(1))
        if (claimed === CUTOFF) return
        const claim = claimed[0]
        if (!claim) {
          if (this.gate.consumeRescan()) {
            budget.remaining += 1
            continue
          }
          return
        }

        const runtime = new AttemptRuntime(this.latch.openAttempt())
        try {
          await this.processClaim(claim, runtime)
        } catch {
          this.logger.error(
            { event: 'notification.lane_failed', deliveryId: claim.id, channel: claim.channel },
            'Notification delivery lane failed (the row recovers via lease expiry)'
          )
        }
        if (runtime.transportPending) {
          // The lane is done but the physical call is not: hand the reservation to the
          // settlement tracker (whenSettled consumes resolve AND reject) and end this lane.
          handedOff = true
          void runtime.whenSettled().then(() => {
            runtime.attempt.dispose()
            release()
          })
          return
        }
        runtime.attempt.dispose()
      }
    } catch {
      this.logger.error({ event: 'notification.lane_failed' }, 'Notification dispatch lane failed')
    } finally {
      // Not handed off to the settlement tracker (which releases later) → release now.
      if (!handedOff) release()
    }
  }

  private async processClaim(claim: ClaimedDelivery, runtime: AttemptRuntime): Promise<void> {
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

    const notification = await this.latch.run(() =>
      this.prisma.notification.findUnique({ where: { id: claim.notificationId } })
    )
    if (notification === CUTOFF) return
    if (!notification) {
      // Notification vanished (e.g. recipient hard-deleted) — nothing to deliver.
      await this.finalizeAndObserve(claim, () =>
        this.repository.finalizePermanent(claim, NotificationErrorCode.NOTIFICATION_MISSING, 0)
      )
      return
    }

    const context = { delivery: claim, notification }
    const admission = this.admissions.create(context, deliverer, {
      signal: runtime.attempt.signal,
      onTransportStarted: (transport) => runtime.onTransportStarted(transport),
    })

    const startedAt = performance.now()
    const outcome = await this.latch.run(() =>
      this.deliverWithTimeout(runtime, claim, () => deliverer.deliver(context, admission))
    )
    if (outcome === CUTOFF) return
    if (isNotStarted(outcome)) {
      // No provider call was made. The row is NOT assumed settled: it is cancelled (target
      // refused), owned elsewhere (lease lost), or still PROCESSING until its lease expires.
      this.logger.info(
        {
          event: 'notification.attempt_not_started',
          deliveryId: claim.id,
          channel: claim.channel,
          reason: outcome.reason,
        },
        'Notification attempt refused at actual-start admission'
      )
      return
    }
    const durationMs = Math.round(performance.now() - startedAt)

    await this.finalizeAndObserve(claim, () => this.applyResult(claim, outcome, durationMs))
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
    const outcome = await this.latch.run(finalize)
    if (outcome === CUTOFF || outcome.state === 'cutoff') return
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

  /**
   * Deliver with a per-attempt timeout. On timeout the attempt's abort signal fires and the
   * ATTEMPT resolves as an ambiguous transient `provider_timeout`; the underlying transport
   * promise keeps being tracked (its slot is held until it settles) and its late result is
   * discarded. A thrown deliverer error is transient by default (bounded by `maxAttempts`);
   * only bounded fields are logged — never an error name or message.
   */
  private async deliverWithTimeout(
    runtime: AttemptRuntime,
    claim: ClaimedDelivery,
    deliver: () => Promise<DeliveryResult | NotStarted>
  ): Promise<DeliveryResult | NotStarted> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<DeliveryResult>((resolve) => {
      timer = setTimeout(() => {
        runtime.attempt.abort()
        resolve({ status: 'transient', errorCode: NotificationErrorCode.PROVIDER_TIMEOUT })
      }, NOTIFICATION_PROVIDER_TIMEOUT_MS)
    })
    try {
      return await Promise.race([
        (async () => deliver())().catch((): DeliveryResult => {
          this.logger.warn(
            { event: 'notification.deliver_threw', deliveryId: claim.id, channel: claim.channel },
            'Notification deliverer threw — treating as transient'
          )
          return { status: 'transient', errorCode: NotificationErrorCode.PROVIDER_ERROR }
        }),
        timeout,
      ])
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
