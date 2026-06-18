import { NotificationChannel } from '../notification.constants'
import { resolveExternalMode } from '../notification-content-policy'
import { validateDefinition } from '../notification-definition.validation'

import { accountPasswordChangedDefinition as def } from './account-password-changed.definition'

describe('accountPasswordChangedDefinition', () => {
  const changedAt = '2026-06-18T10:00:00.000Z'

  it('passes registration validation', () => {
    expect(() => validateDefinition(def)).not.toThrow()
  })

  it('makes both in-app and email mandatory (a security alert is not silenceable)', () => {
    expect(def.mandatoryChannels).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL])
    expect(def.defaultChannels).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL])
  })

  it('resolves email to detailed external exposure', () => {
    expect(resolveExternalMode(def, NotificationChannel.EMAIL)).toBe('detailed')
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
