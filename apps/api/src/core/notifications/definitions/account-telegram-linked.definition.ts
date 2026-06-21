import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

/**
 * Best-effort confirmation that a Telegram account was just linked (Arc D / D.6). Produced by the
 * webhook AFTER the bind transaction commits, through `notify()` — so the worker resolves the fresh
 * connection and the Bot API client stays worker-only. PERSONAL → Telegram resolves to **generic**
 * (no detailed renderer ships today), so it doubles as a live proof that the channel delivers. Not
 * mandatory — Telegram is never forced on a user.
 */
const payloadSchema = z.object({})

type Payload = z.infer<typeof payloadSchema>

export const accountTelegramLinkedDefinition: NotificationDefinition<Payload> = {
  type: 'account.telegram_linked',
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PERSONAL,
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
  defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema,
  safePayload: () => ({}),
  renderInApp: (_payload, locale) =>
    locale === 'en'
      ? { title: 'Telegram linked', body: 'Your Telegram account is now linked to AMCore.' }
      : { title: 'Telegram подключён', body: 'Ваш аккаунт Telegram подключён к AMCore.' },
}
