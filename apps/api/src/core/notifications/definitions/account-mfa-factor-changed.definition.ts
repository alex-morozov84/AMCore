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

const payloadSchema = z
  .object({
    change: z.enum(['enrolled', 'replaced', 'recovery_started']),
    changedAt: z.iso.datetime(),
  })
  .strict()
type Payload = z.infer<typeof payloadSchema>
function content(payload: Payload, locale: SupportedLocale): RenderedNotificationContent {
  if (payload.change === 'recovery_started')
    return locale === 'en'
      ? {
          title: 'Account recovery started',
          body: 'Your deployment operator reset your sign-in protection. Your previous authenticator and backup codes no longer work. Contact your deployment operator if you did not request recovery.',
        }
      : {
          title: 'Начато восстановление доступа',
          body: 'Администратор развёртывания сбросил защиту вашего входа. Прежнее приложение и резервные коды больше не работают. Если вы не запрашивали восстановление, свяжитесь с администратором вашей системы.',
        }
  return locale === 'en'
    ? {
        title:
          payload.change === 'enrolled'
            ? 'Authenticator app connected'
            : 'Authenticator app replaced',
        body: 'An authenticator app was connected to your account. If this was not you, reset your password and contact your deployment operator.',
      }
    : {
        title:
          payload.change === 'enrolled'
            ? 'Защита входа подключена'
            : 'Приложение для кодов заменено',
        body: 'К вашему аккаунту подключили приложение для кодов. Если это были не вы, сбросьте пароль и обратитесь к администратору вашей системы.',
      }
}

/** Security intent contains no seed, code, token or continuation. */
export const accountMfaFactorChangedDefinition: NotificationDefinition<Payload> = {
  type: 'account.mfa_factor_changed',
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
  safePayload: (payload) => ({ change: payload.change, changedAt: payload.changedAt }),
  action: () => ({ route: 'account.security' }),
  renderInApp: (payload, locale) => content(payload, locale),
  projectExternal: (_channel, payload) => ({
    change: payload.change,
    changedAt: payload.changedAt,
  }),
  renderExternal: {
    email: (projection, locale) => content(payloadSchema.parse(projection), locale),
  },
}
