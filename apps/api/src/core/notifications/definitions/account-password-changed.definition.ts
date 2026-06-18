import { z } from 'zod'

import type { NotificationAction, SupportedLocale } from '@amcore/shared'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import type { NotificationDefinition } from '../notification-definition.types'

/**
 * Starter security notification: the account password was changed (Arc B — the first
 * definition with an external channel and a mandatory delivery). Emitted after a
 * successful password reset; the reset also promotes `emailVerified`, so the verified-
 * only email resolver always materializes this alert (see `auth.service.resetPassword`).
 */

/**
 * Allowlisted, bounded payload: only the non-secret change time. The new password,
 * token, and session details never enter the durable payload (ADR-052 — no secrets).
 */
const payloadSchema = z.object({ changedAt: z.iso.datetime() })

type Payload = z.infer<typeof payloadSchema>

function formatChangedAt(changedAt: string, locale: SupportedLocale): string {
  return new Date(changedAt).toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

export const accountPasswordChangedDefinition: NotificationDefinition<Payload> = {
  type: 'account.password_changed',
  category: NotificationCategory.SECURITY,
  schemaVersion: 1,
  // SENSITIVE by class, but email is explicitly `detailed`: a password-change alert
  // should reach the account mailbox in full (OWASP Forgot Password / NIST 800-63B),
  // and the only projected field is the non-secret change time. The class still keeps
  // any future channel without an explicit override on the conservative `generic` path.
  contentClass: NotificationContentClass.SENSITIVE,
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  // Both channels are mandatory — a security alert must not be silenceable.
  mandatoryChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  externalModeByChannel: { [NotificationChannel.EMAIL]: 'detailed' },
  payloadSchema,
  safePayload: (payload) => ({ changedAt: payload.changedAt }),
  // First-party action only: the feed/email CTA routes to the in-app security screen.
  // The email deliverer maps any action to FRONTEND_URL, never an arbitrary URL.
  action: (): NotificationAction => ({ route: 'account.security' }),
  renderInApp: (_payload, locale) =>
    locale === 'en'
      ? { title: 'Password changed', body: 'Your account password was changed.' }
      : { title: 'Пароль изменён', body: 'Пароль вашего аккаунта был изменён.' },
  // The allowlisted projection: only the change time crosses to the email channel.
  projectExternal: (_channel, payload) => ({ changedAt: payload.changedAt }),
  renderEmail: (projection, locale) => {
    const changedAt =
      typeof projection.changedAt === 'string' ? formatChangedAt(projection.changedAt, locale) : ''
    return locale === 'en'
      ? {
          title: 'Your password was changed',
          body: `Your account password was successfully changed on ${changedAt}. For your security, all active sessions were signed out. If you did not make this change, reset your password immediately and contact support.`,
        }
      : {
          title: 'Ваш пароль был изменён',
          body: `Пароль вашего аккаунта был успешно изменён ${changedAt}. В целях безопасности все активные сессии завершены. Если это были не вы, немедленно смените пароль и свяжитесь с поддержкой.`,
        }
  },
}
