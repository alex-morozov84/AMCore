import { NotificationChannel } from '../notification.constants.js'
import { validateDefinition } from '../notification-definition.validation.js'

import { accountMfaFactorChangedDefinition as definition } from './account-mfa-factor-changed.definition.js'

describe('Factor-change security notification', () => {
  it('registers mandatory in-app/email delivery and a first-party security action', () => {
    expect(() => validateDefinition(definition)).not.toThrow()
    expect(definition.mandatoryChannels).toEqual([
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ])
    expect(
      definition.action!({ change: 'enrolled' as const, changedAt: '2026-10-26T12:00:00.000Z' })
    ).toEqual({
      route: 'account.security',
    })
  })

  it('refuses secret-bearing payloads and projects only change kind and event time', () => {
    const payload = { change: 'enrolled' as const, changedAt: '2026-10-26T12:00:00.000Z' }
    for (const key of ['code', 'secret', 'seed', 'accessToken', 'refreshToken', 'password']) {
      expect(definition.payloadSchema.safeParse({ ...payload, [key]: 'fake-secret' }).success).toBe(
        false
      )
    }
    expect(definition.safePayload(payload)).toEqual(payload)
    expect(definition.projectExternal!(NotificationChannel.EMAIL, payload)).toEqual(payload)
  })

  it('explains factor change and a safe response in both supported languages', () => {
    const payload = { change: 'enrolled' as const, changedAt: '2026-10-26T12:00:00.000Z' }
    expect(definition.renderInApp(payload, 'en').body).toContain('reset your password')
    expect(definition.renderInApp(payload, 'ru').body).toContain('сбросьте пароль')
    expect(definition.renderExternal!.email!(payload, 'en')).toEqual(
      definition.renderInApp(payload, 'en')
    )
  })

  it('explains offline recovery without putting the ticket or operator reason in the notification', () => {
    const payload = { change: 'recovery_started' as const, changedAt: '2026-10-26T12:00:00.000Z' }
    expect(definition.renderInApp(payload, 'en').body).toContain('no longer work')
    expect(definition.renderInApp(payload, 'ru').body).toContain('больше не работают')
    for (const field of ['ticket', 'reason', 'password', 'secret'])
      expect(
        definition.payloadSchema.safeParse({ ...payload, [field]: 'fake-private-value' }).success
      ).toBe(false)
    expect(definition.projectExternal!(NotificationChannel.EMAIL, payload)).toEqual(payload)
  })
})
