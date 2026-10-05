import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../prisma'
import type {
  ChannelDeliverer,
  DeliveryAdmission,
  DeliveryContext,
  NotStarted,
  NotStartedReason,
} from '../channels/channel-deliverer.types'
import {
  NOTIFICATION_ADMISSION_LOCK_TIMEOUT_MS,
  NOTIFICATION_LEASE_TTL_MS,
} from '../notification-dispatch.constants'

import { cancelClaimedDelivery } from './notification-delivery-cancellation'
import { CUTOFF, NotificationShutdownLatch } from './notification-shutdown.latch'

import { Prisma } from '@/generated/prisma/client'

/** What the dispatcher needs to know about the single transport call an admission authorized. */
export interface AdmissionRuntime {
  /** The attempt's abort signal (aborted by its own timeout or by the shutdown seal). */
  signal: AbortSignal
  /** Called synchronously with the transport promise right after it was started. */
  onTransportStarted(transport: Promise<unknown>): void
}

type Verdict = 'admitted' | NotStartedReason

function notStarted(reason: NotStartedReason): NotStarted {
  return { status: 'not_started', reason }
}

/**
 * Actual-start admission (ADR-052 / ADR-049: a lease is an ownership identity, not a fence over
 * an external effect). A deliverer prepares its message — which may await rendering — and then
 * hands its ONE transport call to `send`, which authorizes exactly that call:
 *
 * 1. refuse if the attempt was aborted (its timeout fired) or the dispatcher is closed;
 * 2. one short transaction, no provider I/O inside it, in the global lock order
 *    connection row → delivery row: the channel's target check (`FOR SHARE` on the connection),
 *    then the delivery row lock, then — with every lock held — a lease check and renewal using
 *    FRESH database time (`clock_timestamp()`; `now()` is transaction-start time and would
 *    wrongly admit an expired holder that waited on a lock). A `lock_timeout` makes a long lock
 *    wait fail closed instead of stalling the lane;
 * 3. re-check abort/closed synchronously after the awaited commit and invoke the transport in
 *    the same continuation, so an already-aborted attempt makes zero provider calls even for an
 *    adapter that ignores abort.
 *
 * Stated limit: between a successful commit and the HTTP request leaving the process an
 * arbitrary pause can still happen. This admission is the linearization point; the external
 * effect remains at-least-once.
 */
@Injectable()
export class NotificationAttemptAdmission {
  constructor(
    private readonly prisma: PrismaService,
    private readonly latch: NotificationShutdownLatch
  ) {}

  create(
    context: DeliveryContext,
    deliverer: ChannelDeliverer,
    runtime: AdmissionRuntime
  ): DeliveryAdmission {
    let spent = false
    return {
      send: async <T>(transport: (signal: AbortSignal) => Promise<T>): Promise<T | NotStarted> => {
        // One-shot state is spent BEFORE the first await.
        if (spent) throw new Error('delivery_admission_already_used')
        spent = true

        if (runtime.signal.aborted) return notStarted('aborted')
        if (this.latch.closed) return notStarted('closed')

        const verdict = await this.admit(context, deliverer)
        if (verdict === CUTOFF) return notStarted('closed')
        if (verdict !== 'admitted') return notStarted(verdict)

        // Re-check after the awaited commit, adjacent to the transport invocation.
        if (runtime.signal.aborted) return notStarted('aborted')
        if (this.latch.closed) return notStarted('closed')

        const started = transport(runtime.signal)
        runtime.onTransportStarted(started)
        return started
      },
    }
  }

  private admit(
    context: DeliveryContext,
    deliverer: ChannelDeliverer
  ): Promise<Verdict | typeof CUTOFF> {
    const { delivery } = context
    const leaseSeconds = NOTIFICATION_LEASE_TTL_MS / 1000
    return this.latch.transaction(this.prisma, async (tx): Promise<Verdict> => {
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('lock_timeout', ${`${NOTIFICATION_ADMISSION_LOCK_TIMEOUT_MS}ms`}, true)`
      )

      // Lock order: connection (target) first …
      if (deliverer.checkTarget) {
        const refusal = await deliverer.checkTarget(tx, context)
        if (refusal) {
          const cancelled = await cancelClaimedDelivery(tx, delivery, refusal.reason)
          return cancelled ? 'target_revoked' : 'lease_lost'
        }
      }

      // … then the delivery row, then the FRESH-clock lease check + renewal.
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "notifications"."notification_deliveries"
        WHERE id = ${delivery.id}
          AND status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
          AND "leaseToken" = ${delivery.leaseToken}
        FOR UPDATE
      `)
      if (locked.length === 0) return 'lease_lost'

      const renewed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "notifications"."notification_deliveries"
        SET "leaseExpiresAt" = clock_timestamp() + make_interval(secs => ${leaseSeconds}::double precision),
            "updatedAt" = now()
        WHERE id = ${delivery.id}
          AND status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
          AND "leaseToken" = ${delivery.leaseToken}
          AND "leaseExpiresAt" > clock_timestamp()
        RETURNING id
      `)
      return renewed.length === 1 ? 'admitted' : 'lease_expired'
    })
  }
}
