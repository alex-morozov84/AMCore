import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'
import {
  DuplicateNotificationDefinitionError,
  UnknownNotificationTypeError,
} from './notification.errors'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinition } from './notification-definition.types'

function makeDefinition(
  overrides: Partial<NotificationDefinition> & { type: string }
): NotificationDefinition {
  return {
    category: NotificationCategory.ACCOUNT,
    schemaVersion: 1,
    contentClass: NotificationContentClass.PUBLIC,
    defaultChannels: [NotificationChannel.IN_APP],
    mandatoryChannels: [],
    externalModeByChannel: {},
    payloadSchema: z.object({}),
    safePayload: () => ({}),
    renderInApp: () => ({ title: 't', body: 'b' }),
    ...overrides,
  }
}

describe('NotificationDefinitionRegistry', () => {
  describe('construction', () => {
    it('loads the shipped starter definitions without throwing', () => {
      const registry = new NotificationDefinitionRegistry()

      expect(registry.has('account.profile_updated')).toBe(true)
      expect(registry.list().length).toBeGreaterThanOrEqual(1)
    })

    it('throws on a duplicate type', () => {
      const def = makeDefinition({ type: 'account.dup' })

      expect(() => new NotificationDefinitionRegistry([def, def])).toThrow(
        DuplicateNotificationDefinitionError
      )
    })
  })

  describe('get', () => {
    it('returns a registered definition', () => {
      const def = makeDefinition({ type: 'account.x' })
      const registry = new NotificationDefinitionRegistry([def])

      expect(registry.get('account.x')).toBe(def)
    })

    it('throws UnknownNotificationTypeError for an unknown type', () => {
      const registry = new NotificationDefinitionRegistry([])

      expect(() => registry.get('does.not_exist')).toThrow(UnknownNotificationTypeError)
    })
  })

  describe('validatePayload', () => {
    const registry = new NotificationDefinitionRegistry([
      makeDefinition({
        type: 'account.with_payload',
        payloadSchema: z.object({ updatedFields: z.array(z.string().min(1)).min(1) }),
      }),
    ])

    it('returns the parsed payload when valid', () => {
      expect(registry.validatePayload('account.with_payload', { updatedFields: ['name'] })).toEqual(
        {
          updatedFields: ['name'],
        }
      )
    })

    it('throws for an invalid payload', () => {
      expect(() =>
        registry.validatePayload('account.with_payload', { updatedFields: [] })
      ).toThrow()
      expect(() => registry.validatePayload('account.with_payload', {})).toThrow()
    })
  })

  describe('starter definition', () => {
    const registry = new NotificationDefinitionRegistry()

    it('renders localized in-app content', () => {
      const def = registry.get('account.profile_updated')

      expect(def.renderInApp({ updatedFields: ['name'] }, 'en').title).toBe('Profile updated')
      expect(def.renderInApp({ updatedFields: ['name'] }, 'ru').title).toBe('Профиль обновлён')
    })

    it('exposes a safe payload projection', () => {
      const def = registry.get('account.profile_updated')

      expect(def.safePayload({ updatedFields: ['name', 'email'] })).toEqual({
        updatedFields: ['name', 'email'],
      })
    })
  })

  describe('externalMode (content policy)', () => {
    it('defaults a PUBLIC definition to detailed external exposure', () => {
      const registry = new NotificationDefinitionRegistry([
        makeDefinition({ type: 'p.public', contentClass: NotificationContentClass.PUBLIC }),
      ])

      expect(registry.externalMode('p.public', 'email')).toBe('detailed')
    })

    it('defaults SENSITIVE to generic and SECRET to forbidden', () => {
      const registry = new NotificationDefinitionRegistry([
        makeDefinition({ type: 'p.sensitive', contentClass: NotificationContentClass.SENSITIVE }),
        makeDefinition({ type: 'p.secret', contentClass: NotificationContentClass.SECRET }),
      ])

      expect(registry.externalMode('p.sensitive', 'email')).toBe('generic')
      expect(registry.externalMode('p.secret', 'email')).toBe('forbidden')
    })

    it('honors an explicit per-channel override', () => {
      const registry = new NotificationDefinitionRegistry([
        makeDefinition({
          type: 'p.override',
          contentClass: NotificationContentClass.SENSITIVE,
          externalModeByChannel: { [NotificationChannel.EMAIL]: 'detailed' },
        }),
      ])

      expect(registry.externalMode('p.override', NotificationChannel.EMAIL)).toBe('detailed')
    })
  })
})
