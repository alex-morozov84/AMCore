import { NotificationChannel } from '../../notification.constants'
import type {
  ChannelTargetResolver,
  ResolvedDeliveryTarget,
  TargetResolutionContext,
} from '../channel-target-resolver.types'

import { TelegramTerminalReason } from './telegram.constants'

import { TelegramConnectionStatus } from '@/generated/prisma/client'

/**
 * Redact a chat id for the durable `destinationSnapshot` (no full id in the snapshot view):
 * keep the last 4 digits — `***6789`. The routing `targetKey` still carries the full chat id,
 * exactly as the email resolver keeps the full `emailCanonical` in `targetKey`.
 */
function redactChatId(chatId: string): string {
  return chatId.length <= 4 ? '***' : `***${chatId.slice(-4)}`
}

/**
 * Telegram target resolver (ADR-052 / Arc D, core role). One target per recipient — the linked
 * chat. Resolution is a pure projection over the connection facts the producer loaded in its
 * transaction:
 * - no connection → `SKIPPED telegram_not_linked` (observable terminal, keyed by the user id so a
 *   row still exists; never a `PENDING` that would retry an identity absence);
 * - `BLOCKED` → `SKIPPED telegram_destination_unavailable` (a permanent error fenced it — distinct
 *   from never-linked so the two states are observable apart);
 * - `ACTIVE` → a `PENDING` target (`targetKey=chatId`, `targetRef=connection.id`, redacted snapshot).
 */
export class TelegramTargetResolver implements ChannelTargetResolver {
  readonly channel = NotificationChannel.TELEGRAM

  resolveTargets(context: TargetResolutionContext): ResolvedDeliveryTarget[] {
    const telegram = context.recipient.telegram
    if (!telegram) {
      return [
        { targetKey: context.recipient.id, skipReasonCode: TelegramTerminalReason.NOT_LINKED },
      ]
    }

    const target: ResolvedDeliveryTarget = {
      targetKey: telegram.chatId,
      // The connection id is the D.5 generation fence: a fresh row per link/relink.
      targetRef: telegram.connectionId,
      destinationSnapshot: { chatId: redactChatId(telegram.chatId) },
    }
    if (telegram.status === TelegramConnectionStatus.BLOCKED) {
      target.skipReasonCode = TelegramTerminalReason.DESTINATION_UNAVAILABLE
    }
    return [target]
  }
}
