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

/**
 * Allowlisted, bounded payload: even a trusted internal producer must keep the
 * durable payload small and predictable (row/queue/log/render cost). `updatedFields`
 * is an enum of known profile fields, not free-form strings.
 */
const PROFILE_FIELDS = ['name', 'email', 'locale', 'timezone', 'avatar', 'phone'] as const

const payloadSchema = z.object({
  updatedFields: z.array(z.enum(PROFILE_FIELDS)).min(1).max(PROFILE_FIELDS.length),
})

type Payload = z.infer<typeof payloadSchema>

export const accountProfileUpdatedDefinition: NotificationDefinition<Payload> = {
  type: 'account.profile_updated',
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  supportedChannels: [NotificationChannel.IN_APP],
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
