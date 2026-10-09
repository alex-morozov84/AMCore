import { Injectable } from '@nestjs/common'

import { coerceSupportedLocale, localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

import { PrismaService } from '../../../../prisma'
import { cancelActiveDeliveries } from '../../dispatch/notification-delivery-cancellation'
import type { ClaimedDelivery } from '../../dispatch/notification-dispatch.types'
import { NotificationPreparedRequestService } from '../../dispatch/notification-prepared-request.service'
import { NotificationShutdownLatch } from '../../dispatch/notification-shutdown.latch'
import { NotificationChannel } from '../../notification.constants'
import { resolveExternalMode } from '../../notification-content-policy'
import { NotificationDefinitionRegistry } from '../../notification-definition.registry'
import type { RenderedNotificationContent } from '../../notification-definition.types'
import {
  type ChannelDeliverer,
  type DeliveryAdmission,
  type DeliveryContext,
  type DeliveryResult,
  isNotStarted,
  type NotStarted,
  type TargetRefusal,
} from '../channel-deliverer.types'
import {
  NotificationPreparationError,
  preparedNotificationRequest,
} from '../notification-prepared-request'

import {
  TELEGRAM_FENCING_ERROR_CODES,
  TelegramCancelReason,
  TelegramDeliveryError,
} from './telegram.constants'
import { TelegramBotApiClient } from './telegram-bot-api.client'
import { telegramGenericMessages } from './telegram-messages'

import { canonicalJsonHash } from '@/common/utils/canonical-json'
import { EnvService } from '@/env/env.service'
import { Prisma, TelegramConnectionStatus } from '@/generated/prisma/client'

interface ConnectionRow {
  userId: string
  chatId: string
  status: string
}

/**
 * Telegram channel deliverer (ADR-052 / Arc D, worker-only). Mirrors the email deliverer:
 * generic neutral content by default, detailed ONLY via the definition's
 * `projectExternal('telegram')` + `renderExternal.telegram` allowlist (enforced external boundary), sent as
 * **plain text** (no `parse_mode`) by `TelegramBotApiClient`. On a permanent **destination** error
 * (blocked / chat-not-found / migrated) it fences the exact connection (conditional block + cancel
 * its other active deliveries); a non-destination permanent never disables a user's connection.
 *
 * Target generation: `targetRef` is the connection id, a fresh row per link/relink. Actual-start
 * admission re-checks it under `FOR SHARE` (`checkTarget`), so a delivery whose connection was
 * unlinked, replaced, blocked or never belonged to this recipient/chat makes NO provider call.
 */
@Injectable()
export class TelegramChannelDeliverer implements ChannelDeliverer {
  readonly channel = NotificationChannel.TELEGRAM

  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly client: TelegramBotApiClient,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly latch: NotificationShutdownLatch,
    private readonly prepared: NotificationPreparedRequestService
  ) {}

  async deliver(
    context: DeliveryContext,
    admission: DeliveryAdmission
  ): Promise<DeliveryResult | NotStarted> {
    try {
      this.registry.getStored(context.notification.type, context.notification.schemaVersion)
    } catch {
      return { status: 'permanent', errorCode: 'notification_version_unavailable' }
    }
    const { delivery } = context
    const binding = `telegram:TELEGRAM_BOT_TOKEN:${canonicalJsonHash(this.env.get('TELEGRAM_API_BASE_URL').replace(/\/+$/, ''))}`
    const request = await this.prepared.obtain(
      context,
      this,
      binding,
      'sendMessage',
      null,
      async () => {
        const { notification } = context
        const locale = coerceSupportedLocale(delivery.locale)

        const content = this.resolveContent(
          notification.type,
          notification.schemaVersion,
          notification.payload,
          locale
        )
        if (content === 'version_unavailable') {
          throw new NotificationPreparationError('notification_version_unavailable')
        }
        if (content === 'forbidden') {
          throw new NotificationPreparationError(TelegramDeliveryError.CONTENT_FORBIDDEN)
        }
        if (content === 'payload_invalid') {
          throw new NotificationPreparationError(TelegramDeliveryError.PAYLOAD_INVALID)
        }

        const text = this.composeText(content, notification.action !== null, locale)
        return preparedNotificationRequest(
          context,
          binding,
          'sendMessage',
          JSON.stringify({ chat_id: delivery.targetKey, text }),
          null
        )
      }
    )
    if ('status' in request) return request
    const result = await admission.send((signal) =>
      this.client.sendPreparedMessage(request.body, signal)
    )
    if (isNotStarted(result)) return result

    if (result.status === 'delivered') {
      return { status: 'delivered', providerMessageId: result.providerMessageId }
    }
    if (result.status === 'transient') {
      return { status: 'transient', errorCode: result.errorCode, retryAfterMs: result.retryAfterMs }
    }
    if (TELEGRAM_FENCING_ERROR_CODES.has(result.errorCode)) {
      await this.fenceConnection(delivery)
    }
    return { status: 'permanent', errorCode: result.errorCode }
  }

  /**
   * Admission-time target check (inside the admission transaction, connection lock first): the
   * connection must exist by `targetRef`, belong to this recipient, still be this chat, and be
   * `ACTIVE`. Never swallows a query error.
   */
  async checkTarget(
    tx: Prisma.TransactionClient,
    context: DeliveryContext
  ): Promise<TargetRefusal | null> {
    const { delivery, notification } = context
    if (!delivery.targetRef) return { reason: TelegramCancelReason.TARGET_REVOKED }
    const rows = await tx.$queryRaw<ConnectionRow[]>(Prisma.sql`
      SELECT "userId", "chatId", status
      FROM "notifications"."telegram_connections"
      WHERE id = ${delivery.targetRef}
      FOR SHARE
    `)
    const connection = rows[0]
    if (
      !connection ||
      connection.userId !== notification.recipientUserId ||
      connection.chatId !== delivery.targetKey
    ) {
      return { reason: TelegramCancelReason.TARGET_REVOKED }
    }
    if (connection.status !== TelegramConnectionStatus.ACTIVE) {
      return { reason: TelegramCancelReason.CONNECTION_BLOCKED }
    }
    return null
  }

  /** Plain-text message: title + body, plus the trusted app link when a first-party action exists. */
  private composeText(
    content: RenderedNotificationContent,
    hasAction: boolean,
    locale: SupportedLocale
  ): string {
    const base = `${content.title}\n\n${content.body}`
    // Locale-prefixed: the recipient may open this from a client that has never
    // visited the app, so cookie/`Accept-Language` cannot be relied on.
    const url = localizedFrontendUrl(this.env.get('FRONTEND_URL'), locale)
    return hasAction ? `${base}\n\n${url}` : base
  }

  /**
   * Conditionally block the exact connection used by this delivery and cancel its OTHER active
   * deliveries, in one guarded transaction (connection lock first, so it serializes with unlink/
   * relink/producer/admission). The initiating delivery is excluded: it keeps its own permanent
   * failure trail when it wins its finalize CAS (the winning CAS decides history — an independent
   * unlink/reaper may win first). The `id + chatId + status=ACTIVE` predicate is the generation
   * fence: a late old leased send (its `targetRef` is the prior, deleted id) matches **no** row,
   * so it cannot disable a freshly relinked connection (ADR-049). After the shutdown seal this
   * does nothing. Idempotent and self-contained.
   */
  private async fenceConnection(delivery: ClaimedDelivery): Promise<void> {
    const connectionId = delivery.targetRef
    if (!connectionId) return
    await this.latch.transaction(this.prisma, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM "notifications"."telegram_connections" WHERE id = ${connectionId} FOR UPDATE
      `)
      if (locked.length === 0) return
      const blocked = await tx.telegramConnection.updateMany({
        where: {
          id: connectionId,
          chatId: delivery.targetKey,
          status: TelegramConnectionStatus.ACTIVE,
        },
        data: { status: TelegramConnectionStatus.BLOCKED },
      })
      if (blocked.count === 0) return
      await cancelActiveDeliveries(tx, {
        channel: NotificationChannel.TELEGRAM,
        targetRef: connectionId,
        reason: TelegramCancelReason.CONNECTION_BLOCKED,
        exceptDeliveryId: delivery.id,
      })
    })
  }

  /** Localized content, or a terminal sentinel — detailed only from the allowlisted projection. */
  private resolveContent(
    type: string,
    schemaVersion: number,
    payload: unknown,
    locale: SupportedLocale
  ): RenderedNotificationContent | 'forbidden' | 'payload_invalid' | 'version_unavailable' {
    let definition
    try {
      definition = this.registry.getStored(type, schemaVersion)
    } catch {
      return 'version_unavailable'
    }
    const decoded = definition.payloadSchema.safeParse(payload)
    if (!decoded.success) return 'payload_invalid'
    const mode = resolveExternalMode(definition, NotificationChannel.TELEGRAM)
    if (mode === 'forbidden') return 'forbidden'

    if (mode === 'detailed' && definition.renderExternal?.telegram && definition.projectExternal) {
      const parsed = definition.payloadSchema.safeParse(payload)
      if (!parsed.success) return 'payload_invalid'
      const projection = definition.projectExternal(NotificationChannel.TELEGRAM, parsed.data)
      return definition.renderExternal?.telegram(projection, locale)
    }
    return this.genericContent(locale)
  }

  private genericContent(locale: SupportedLocale): RenderedNotificationContent {
    return telegramGenericMessages[locale]
  }
}
