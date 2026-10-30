import { z } from 'zod'

import type { SupportedLocale } from '@amcore/shared'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants.js'
import type {
  NotificationDefinition,
  RenderedNotificationContent,
} from '../notification-definition.types.js'

const payloadSchema = z.object({ changedAt: z.iso.datetime() }).strict()
type Payload = z.infer<typeof payloadSchema>
function content(locale: SupportedLocale): RenderedNotificationContent {
  return locale === 'en'
    ? {
        title: 'New backup codes generated',
        body: 'New backup codes were generated. Previous unused codes no longer work. If this was not you, reset your password and contact your deployment operator.',
      }
    : {
        title: 'Создан новый набор резервных кодов',
        body: 'Создан новый набор резервных кодов. Старые неиспользованные коды больше не работают. Если это были не вы, сбросьте пароль и обратитесь к администратору вашей системы.',
      }
}

/** Only the event time is durable; no code, factor seed, token or session credential. */
export const accountMfaBackupCodesChangedDefinition: NotificationDefinition<Payload> = {
  type: 'account.mfa_backup_codes_changed',
  category: NotificationCategory.SECURITY,
  schemaVersion: 1,
  contentClass: NotificationContentClass.SENSITIVE,
  supportedChannels: [
    NotificationChannel.IN_APP,
    NotificationChannel.EMAIL,
    NotificationChannel.TELEGRAM,
  ],
  defaultChannels: [
    NotificationChannel.IN_APP,
    NotificationChannel.EMAIL,
    NotificationChannel.TELEGRAM,
  ],
  mandatoryChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  externalModeByChannel: { [NotificationChannel.EMAIL]: 'detailed' },
  payloadSchema,
  safePayload: (payload) => ({ changedAt: payload.changedAt }),
  action: () => ({ route: 'account.security' }),
  renderInApp: (_payload, locale) => content(locale),
  projectExternal: (_channel, payload) => ({ changedAt: payload.changedAt }),
  renderExternal: { email: (_projection, locale) => content(locale) },
}
