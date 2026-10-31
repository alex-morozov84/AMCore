import { coerceSupportedLocale } from '@amcore/shared'

import { NotificationChannel } from '../notification.constants.js'
import { validateDefinition } from '../notification-definition.validation.js'

import { accountMfaBackupCodesChangedDefinition as definition } from './account-mfa-backup-codes-changed.definition.js'

const safeResponse = { en: 'reset your password', ru: 'сбросьте пароль' }

describe('Backup-code replacement security notification', () => {
  it('registers mandatory in-app/email delivery and a first-party security action', () => {
    expect(() => validateDefinition(definition)).not.toThrow()
    expect(definition.mandatoryChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ])
    expect(definition.action!({ changedAt: '2026-10-26T12:00:00.000Z' })).toEqual({
      route: 'account.security',
    })
  })

  it('refuses secret-bearing payloads and projects only the event time', () => {
    const payload = { changedAt: '2026-10-26T12:00:00.000Z' }
    for (const key of ['code', 'secret', 'seed', 'accessToken', 'refreshToken', 'password']) {
      expect(definition.payloadSchema.safeParse({ ...payload, [key]: 'fake-secret' }).success).toBe(
        false
      )
    }
    expect(definition.safePayload(payload)).toEqual(payload)
    expect(definition.projectExternal!(NotificationChannel.EMAIL, payload)).toEqual(payload)
  })

  it('explains backup-code replacement and a safe response in supported languages', () => {
    const payload = { changedAt: '2026-10-26T12:00:00.000Z' }
    expect(definition.renderInApp(payload, coerceSupportedLocale('en')).body).toContain(
      safeResponse[coerceSupportedLocale('en')]
    )
    expect(definition.renderInApp(payload, coerceSupportedLocale('ru')).body).toContain(
      safeResponse[coerceSupportedLocale('ru')]
    )
    expect(definition.renderExternal!.email!({}, coerceSupportedLocale('en'))).toEqual(
      definition.renderInApp(payload, coerceSupportedLocale('en'))
    )
  })
})
