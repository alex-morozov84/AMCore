import { Injectable } from '@nestjs/common'
import { NotificationDeliveryStatus, TelegramConnectionStatus } from '@prisma/client'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { PrismaService } from '../../../../prisma'
import { NotificationChannel } from '../../notification.constants'
import { resolveExternalMode } from '../../notification-content-policy'
import { NotificationDefinitionRegistry } from '../../notification-definition.registry'
import type { RenderedNotificationContent } from '../../notification-definition.types'
import type { ChannelDeliverer, DeliveryContext, DeliveryResult } from '../channel-deliverer.types'

import {
  TELEGRAM_FENCING_ERROR_CODES,
  TelegramCancelReason,
  TelegramDeliveryError,
} from './telegram.constants'
import { TelegramBotApiClient } from './telegram-bot-api.client'
import { telegramGenericMessages } from './telegram-messages'

import { EnvService } from '@/env/env.service'

function toLocale(value: string): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : DEFAULT_LOCALE
}

/**
 * Telegram channel deliverer (ADR-052 / Arc D, worker-only). Mirrors the email deliverer:
 * generic neutral content by default, detailed ONLY via the definition's
 * `projectExternal('telegram')` + `renderTelegram` allowlist (enforced external boundary), sent as
 * **plain text** (no `parse_mode`) by `TelegramBotApiClient`. On a permanent **destination** error
 * (blocked / chat-not-found / migrated) it fences the exact connection (conditional block + cancel
 * its other due deliveries); a non-destination permanent never disables a user's connection.
 */
@Injectable()
export class TelegramChannelDeliverer implements ChannelDeliverer {
  readonly channel = NotificationChannel.TELEGRAM

  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly client: TelegramBotApiClient,
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  async deliver(context: DeliveryContext): Promise<DeliveryResult> {
    const { delivery, notification } = context
    const locale = toLocale(delivery.locale)

    const content = this.resolveContent(notification.type, notification.payload, locale)
    if (content === 'forbidden') {
      return { status: 'permanent', errorCode: TelegramDeliveryError.CONTENT_FORBIDDEN }
    }
    if (content === 'payload_invalid') {
      return { status: 'permanent', errorCode: TelegramDeliveryError.PAYLOAD_INVALID }
    }

    const text = this.composeText(content, notification.action !== null)
    const result = await this.client.sendMessage({ chatId: delivery.targetKey, text })

    if (result.status === 'delivered') {
      return { status: 'delivered', providerMessageId: result.providerMessageId }
    }
    if (result.status === 'transient') {
      return { status: 'transient', errorCode: result.errorCode, retryAfterMs: result.retryAfterMs }
    }
    if (TELEGRAM_FENCING_ERROR_CODES.has(result.errorCode)) {
      await this.fenceConnection(delivery.targetRef, delivery.targetKey)
    }
    return { status: 'permanent', errorCode: result.errorCode }
  }

  /** Plain-text message: title + body, plus the trusted app link when a first-party action exists. */
  private composeText(content: RenderedNotificationContent, hasAction: boolean): string {
    const base = `${content.title}\n\n${content.body}`
    return hasAction ? `${base}\n\n${this.env.get('FRONTEND_URL')}` : base
  }

  /**
   * Conditionally block the exact connection used by this delivery and cancel its other due
   * deliveries. The `id + chatId + status=ACTIVE` predicate is the generation fence: a late old
   * leased send (its `targetRef` is the prior, deleted id) matches **no** row, so it cannot
   * disable a freshly relinked connection (ADR-049). Idempotent and self-contained.
   */
  private async fenceConnection(connectionId: string | null, chatId: string): Promise<void> {
    if (!connectionId) return
    await this.prisma.$transaction(async (tx) => {
      const blocked = await tx.telegramConnection.updateMany({
        where: { id: connectionId, chatId, status: TelegramConnectionStatus.ACTIVE },
        data: { status: TelegramConnectionStatus.BLOCKED },
      })
      if (blocked.count === 0) return
      await tx.notificationDelivery.updateMany({
        where: {
          targetRef: connectionId,
          channel: NotificationChannel.TELEGRAM,
          status: {
            in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRY_SCHEDULED],
          },
        },
        data: {
          status: NotificationDeliveryStatus.CANCELLED,
          terminalReasonCode: TelegramCancelReason.CONNECTION_BLOCKED,
        },
      })
    })
  }

  /** Localized content, or a terminal sentinel — detailed only from the allowlisted projection. */
  private resolveContent(
    type: string,
    payload: unknown,
    locale: SupportedLocale
  ): RenderedNotificationContent | 'forbidden' | 'payload_invalid' {
    if (!this.registry.has(type)) return this.genericContent(locale)

    const definition = this.registry.get(type)
    const mode = resolveExternalMode(definition, NotificationChannel.TELEGRAM)
    if (mode === 'forbidden') return 'forbidden'

    if (mode === 'detailed' && definition.renderTelegram && definition.projectExternal) {
      const parsed = definition.payloadSchema.safeParse(payload)
      if (!parsed.success) return 'payload_invalid'
      const projection = definition.projectExternal(NotificationChannel.TELEGRAM, parsed.data)
      return definition.renderTelegram(projection, locale)
    }
    return this.genericContent(locale)
  }

  private genericContent(locale: SupportedLocale): RenderedNotificationContent {
    return telegramGenericMessages[locale]
  }
}
