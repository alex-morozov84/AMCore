import type { ClaimedDelivery } from '../dispatch/notification-dispatch.types'
import type { NotificationChannel } from '../notification.constants'

import type { Notification } from '@/generated/prisma/client'

/** Everything a deliverer needs for one attempt: the claimed delivery + its notification. */
export interface DeliveryContext {
  delivery: ClaimedDelivery
  notification: Notification
}

/**
 * Provider outcome for one delivery attempt, mapped by the dispatcher to a durable
 * transition: `delivered` → DELIVERED; `transient` → RETRY_SCHEDULED/exhausted;
 * `permanent` → FAILED. Error codes are bounded strings, never provider bodies.
 */
export type DeliveryResult =
  | { status: 'delivered'; providerMessageId?: string }
  | {
      status: 'transient'
      errorCode: string
      /**
       * Optional provider-requested retry **floor** in ms (e.g. Telegram `retry_after`).
       * The dispatcher schedules `max(normalBackoff, now + retryAfterMs)`, clamped by a
       * dedicated defensive max — never below the normal backoff, never the 15-min cap.
       */
      retryAfterMs?: number
    }
  | { status: 'permanent'; errorCode: string }

/**
 * Worker-role half of a channel (ADR-052): performs the actual provider I/O. Separate
 * from the core `ChannelTargetResolver` so provider clients (`EmailService`, Bot API)
 * never enter the web role. Registered per channel; Telegram/Web Push add their own.
 */
export interface ChannelDeliverer {
  readonly channel: NotificationChannel
  deliver(context: DeliveryContext): Promise<DeliveryResult>
}
