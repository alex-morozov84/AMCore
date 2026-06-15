import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

/**
 * Starter in-app-only informational notification: the user's profile was updated.
 * Demonstrates the definition contract (payload validation, safe projection,
 * localized render) without an external channel — external adapters arrive in Arc B+.
 */

const payloadSchema = z.object({
  updatedFields: z.array(z.string().min(1)).min(1),
})

type Payload = z.infer<typeof payloadSchema>

export const accountProfileUpdatedDefinition: NotificationDefinition<Payload> = {
  type: 'account.profile_updated',
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  defaultChannels: [NotificationChannel.IN_APP],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema,
  safePayload: (payload) => ({ updatedFields: payload.updatedFields }),
  renderInApp: (payload, locale) => {
    const count = payload.updatedFields.length
    return locale === 'en'
      ? { title: 'Profile updated', body: `You updated ${count} profile field(s).` }
      : { title: 'Профиль обновлён', body: `Вы изменили полей профиля: ${count}.` }
  },
}
