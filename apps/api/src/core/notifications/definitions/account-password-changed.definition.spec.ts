import { NotificationChannel } from '../notification.constants'
import { resolveExternalMode } from '../notification-content-policy'
import { validateDefinition } from '../notification-definition.validation'

import { accountPasswordChangedDefinition as def } from './account-password-changed.definition'

describe('accountPasswordChangedDefinition', () => {
  const changedAt = '2026-06-18T10:00:00.000Z'

  it('passes registration validation', () => {
    expect(() => validateDefinition(def)).not.toThrow()
  })

  it('keeps in-app and email mandatory, with Telegram an optional default (Arc D)', () => {
    expect(def.mandatoryChannels).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL])
    expect(def.defaultChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
      NotificationChannel.TELEGRAM,
    ])
    expect(def.supportedChannels).toContain(NotificationChannel.TELEGRAM)
    // Telegram is NOT mandatory — a user can disable it.
    expect(def.mandatoryChannels).not.toContain(NotificationChannel.TELEGRAM)
  })

  it('resolves email to detailed but keeps Telegram generic plain-text', () => {
    expect(resolveExternalMode(def, NotificationChannel.EMAIL)).toBe('detailed')
    expect(resolveExternalMode(def, NotificationChannel.TELEGRAM)).toBe('generic')
  })

  it('accepts a valid ISO datetime payload and rejects a malformed one', () => {
    expect(def.payloadSchema.safeParse({ changedAt }).success).toBe(true)
    expect(def.payloadSchema.safeParse({ changedAt: 'not-a-date' }).success).toBe(false)
  })

  it('projects only the change time to email (no secret leakage)', () => {
    const projection = def.projectExternal!(NotificationChannel.EMAIL, { changedAt })
    expect(projection).toEqual({ changedAt })
  })

  it('renders detailed email copy from the projection in both locales', () => {
    const en = def.renderEmail!({ changedAt }, 'en')
    expect(en.title).toBe('Your password was changed')
    expect(en.body).toContain('successfully changed')

    const ru = def.renderEmail!({ changedAt }, 'ru')
    expect(ru.title).toBe('Ваш пароль был изменён')
    expect(ru.body).toContain('успешно изменён')
  })

  it('renders a neutral in-app title/body without exposing the payload', () => {
    expect(def.renderInApp({ changedAt }, 'en').title).toBe('Password changed')
    expect(def.renderInApp({ changedAt }, 'ru').title).toBe('Пароль изменён')
  })

  it('exposes a first-party action route only (no arbitrary URL)', () => {
    expect(def.action!({ changedAt })).toEqual({ route: 'account.security' })
  })
})
