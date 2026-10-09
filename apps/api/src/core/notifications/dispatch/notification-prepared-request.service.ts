import { Injectable } from '@nestjs/common'

import type {
  ChannelDeliverer,
  DeliveryContext,
  NotStarted,
} from '../channels/channel-deliverer.types'
import { NotificationChannelRegistry } from '../channels/notification-channel.registry'
import {
  NotificationPreparationError,
  type PreparedNotificationRequest,
  validatePreparedRequest,
} from '../channels/notification-prepared-request'
import { NOTIFICATION_ADMISSION_LOCK_TIMEOUT_MS } from '../notification-dispatch.constants'

import { cancelClaimedDelivery } from './notification-delivery-cancellation'
import { CUTOFF, NotificationShutdownLatch } from './notification-shutdown.latch'

import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

export type PreparedRequestResult =
  PreparedNotificationRequest | NotStarted | { status: 'permanent'; errorCode: string }

class InvalidPreparedRequestError extends Error {}

/** Freeze once under the owned lease; actual-start admission still follows this preparation. */
@Injectable()
export class NotificationPreparedRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: NotificationChannelRegistry,
    private readonly latch: NotificationShutdownLatch
  ) {}

  async obtain(
    context: DeliveryContext,
    deliverer: ChannelDeliverer,
    binding: string,
    path: string,
    key: string | null,
    prepare: () => Promise<PreparedNotificationRequest>
  ): Promise<PreparedRequestResult> {
    if (this.latch.closed) return { status: 'not_started', reason: 'closed' }
    if (!this.channels.available(context.delivery.channel)) {
      return { status: 'permanent', errorCode: 'notification_channel_unavailable' }
    }
    const row = await this.latch.run(() =>
      this.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: context.delivery.id },
        select: { requestContractVersion: true, preparedRequest: true, preparedRequestHash: true },
      })
    )
    if (row === CUTOFF) return { status: 'not_started', reason: 'closed' }
    if (row.requestContractVersion !== 1) {
      return { status: 'permanent', errorCode: 'legacy_delivery_outcome_unverified' }
    }
    try {
      const descriptor = this.channels.get(context.delivery.channel)
      const validate = (value: unknown): ReturnType<typeof validatePreparedRequest> => {
        try {
          return validatePreparedRequest(value, context, descriptor, binding, path, key)
        } catch {
          throw new InvalidPreparedRequestError()
        }
      }
      if (row.preparedRequest !== null || row.preparedRequestHash !== null) {
        const stored = validate(row.preparedRequest)
        if (stored.hash !== row.preparedRequestHash) throw new InvalidPreparedRequestError()
        return stored.request
      }
      let value: PreparedNotificationRequest
      try {
        value = await prepare()
      } catch (error) {
        if (error instanceof NotificationPreparationError) throw error
        throw new InvalidPreparedRequestError()
      }
      const candidate = validate(value)
      if (this.latch.closed) return { status: 'not_started', reason: 'closed' }
      const saved = await this.latch.transaction(this.prisma, async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT set_config('lock_timeout', ${`${NOTIFICATION_ADMISSION_LOCK_TIMEOUT_MS}ms`}, true)`
        )
        if (deliverer.checkTarget) {
          const refusal = await deliverer.checkTarget(tx, context)
          if (refusal) {
            const cancelled = await cancelClaimedDelivery(tx, context.delivery, refusal.reason)
            return {
              status: 'not_started',
              reason: cancelled ? 'target_revoked' : 'lease_lost',
            } as const
          }
        }
        const rows = await tx.$queryRaw<
          { preparedRequest: unknown; preparedRequestHash: string | null }[]
        >(Prisma.sql`
          SELECT "preparedRequest", "preparedRequestHash" FROM "notifications"."notification_deliveries"
          WHERE id = ${context.delivery.id} AND status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
            AND "leaseToken" = ${context.delivery.leaseToken} AND "requestContractVersion" = 1 FOR UPDATE
        `)
        const current = rows[0]
        if (!current) return { status: 'not_started', reason: 'lease_lost' } as const
        if (current.preparedRequest !== null || current.preparedRequestHash !== null) {
          const winner = validate(current.preparedRequest)
          if (winner.hash !== current.preparedRequestHash) throw new InvalidPreparedRequestError()
          return winner.request
        }
        const changed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          UPDATE "notifications"."notification_deliveries"
          SET "preparedRequest" = ${JSON.stringify(candidate.request)}::jsonb,
              "preparedRequestHash" = ${candidate.hash}, "updatedAt" = now()
          WHERE id = ${context.delivery.id} AND status = 'PROCESSING'::"notifications"."NotificationDeliveryStatus"
            AND "leaseToken" = ${context.delivery.leaseToken} AND "leaseExpiresAt" > clock_timestamp()
            AND "preparedRequest" IS NULL AND "preparedRequestHash" IS NULL RETURNING id
        `)
        return changed.length
          ? candidate.request
          : ({ status: 'not_started', reason: 'lease_expired' } as const)
      })
      return saved === CUTOFF ? { status: 'not_started', reason: 'closed' } : saved
    } catch (error) {
      if (error instanceof NotificationPreparationError)
        return { status: 'permanent', errorCode: error.code }
      if (!(error instanceof InvalidPreparedRequestError)) throw error
      return { status: 'permanent', errorCode: 'notification_prepared_request_invalid' }
    }
  }
}
