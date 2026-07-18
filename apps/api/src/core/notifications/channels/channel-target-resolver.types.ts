import type { NotificationChannel } from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

import type { Prisma, TelegramConnectionStatus } from '@/generated/prisma/client'

/** Telegram connection facts (Arc D), loaded only when a definition supports the channel. */
export interface TargetRecipientTelegram {
  connectionId: string
  chatId: string
  status: TelegramConnectionStatus
}

/**
 * Recipient facts a target resolver may read. Loaded once by the producer inside its
 * transaction so resolution is consistent with the notification write (notifyTx).
 */
export interface TargetRecipient {
  id: string
  email: string
  emailCanonical: string
  emailVerified: boolean
  locale: string
  /** Present (or explicitly `null`) only when the definition supports the Telegram channel. */
  telegram?: TargetRecipientTelegram | null
}

/** Inputs available when resolving an external channel's delivery targets. */
export interface TargetResolutionContext {
  recipient: TargetRecipient
  definition: NotificationDefinition
  payload: unknown
  locale: string
}

/**
 * One resolved external delivery target. When `skipReasonCode` is set the producer
 * writes the delivery as `SKIPPED` (an observable terminal state) instead of
 * `PENDING`, so the dispatcher never retries a destination/identity absence.
 */
export interface ResolvedDeliveryTarget {
  /** Stable adapter-owned identity, unique within (notification, channel). */
  targetKey: string
  /** Optional durable connection/subscription aggregate ref (Telegram/Web Push later). */
  targetRef?: string | null
  /** Redacted destination snapshot — never a live secret. */
  destinationSnapshot?: Prisma.InputJsonValue
  /** Set → write the delivery `SKIPPED` with this bounded terminal reason. */
  skipReasonCode?: string
}

/**
 * Produce-time target resolution for one external channel (ADR-052). This is the
 * **core-role** half of a channel — a pure projection over already-loaded recipient
 * facts, safe to run in the web role. The worker-role `ChannelDeliverer` (provider
 * I/O) is registered separately so `EmailService`/Bot clients never leak into web.
 */
export interface ChannelTargetResolver {
  readonly channel: NotificationChannel
  resolveTargets(context: TargetResolutionContext): ResolvedDeliveryTarget[]
}
