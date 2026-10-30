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

const payloadSchema = z.object({ usedAt: z.iso.datetime() }).strict()
type Payload = z.infer<typeof payloadSchema>
function content(locale: SupportedLocale): RenderedNotificationContent {
  return locale === 'en'
    ? {
        title: 'A backup code was used',
        body: 'A backup code was used to confirm your identity. If this was not you, reset your password and contact your deployment operator.',
      }
    : {
        title: 'Использован резервный код',
        body: 'Резервный код использован для подтверждения вашей личности. Если это были не вы, сбросьте пароль и обратитесь к администратору вашей системы.',
      }
}

/** Only the event time is durable; no code, factor seed, token or session credential. */
export const accountMfaBackupUsedDefinition: NotificationDefinition<Payload> = {
  type: 'account.mfa_backup_used',
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
  safePayload: (payload) => ({ usedAt: payload.usedAt }),
  action: () => ({ route: 'account.security' }),
  renderInApp: (_payload, locale) => content(locale),
  projectExternal: (_channel, payload) => ({ usedAt: payload.usedAt }),
  renderExternal: { email: (_projection, locale) => content(locale) },
}
