import { NotificationChannel } from '../notification.constants.js'
import { validateDefinition } from '../notification-definition.validation.js'

import { accountMfaBackupUsedDefinition as definition } from './account-mfa-backup-used.definition.js'

describe('Backup-code security notification', () => {
  it('registers mandatory in-app/email delivery and a first-party security action', () => {
    expect(() => validateDefinition(definition)).not.toThrow()
    expect(definition.mandatoryChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ])
    expect(definition.action!({ usedAt: '2026-10-26T12:00:00.000Z' })).toEqual({
      route: 'account.security',
    })
  })

  it('refuses secret-bearing payloads and projects only the event time', () => {
    const payload = { usedAt: '2026-10-26T12:00:00.000Z' }
    for (const key of ['code', 'secret', 'seed', 'accessToken', 'refreshToken', 'password']) {
      expect(definition.payloadSchema.safeParse({ ...payload, [key]: 'fake-secret' }).success).toBe(
        false
      )
    }
    expect(definition.safePayload(payload)).toEqual(payload)
    expect(definition.projectExternal!(NotificationChannel.EMAIL, payload)).toEqual(payload)
  })

  it('explains backup-code use and a safe response in both supported languages', () => {
    const payload = { usedAt: '2026-10-26T12:00:00.000Z' }
    expect(definition.renderInApp(payload, 'en').body).toContain('reset your password')
    expect(definition.renderInApp(payload, 'ru').body).toContain('сбросьте пароль')
    expect(definition.renderExternal!.email!({}, 'en')).toEqual(
      definition.renderInApp(payload, 'en')
    )
  })
})
