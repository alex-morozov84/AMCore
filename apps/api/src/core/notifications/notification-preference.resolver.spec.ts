import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'
import type { NotificationDefinition } from './notification-definition.types'
import {
  NotificationPreferenceResolver,
  type PreferenceRow,
} from './notification-preference.resolver'

function makeDef(overrides: Partial<NotificationDefinition>): NotificationDefinition {
  return {
    type: 'account.test',
    category: NotificationCategory.ACCOUNT,
    schemaVersion: 1,
    contentClass: NotificationContentClass.PUBLIC,
    supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    defaultChannels: [NotificationChannel.IN_APP],
    mandatoryChannels: [],
    externalModeByChannel: {},
    payloadSchema: z.object({}),
    safePayload: () => ({}),
    renderInApp: () => ({ title: 't', body: 'b' }),
    // PUBLIC + supported EMAIL resolves to detailed, so a registration-valid fixture
    // must provide a projection (the resolver itself ignores it).
    projectExternal: () => ({}),
    ...overrides,
  }
}

describe('NotificationPreferenceResolver', () => {
  const resolver = new NotificationPreferenceResolver()

  const resolve = (
    def: NotificationDefinition,
    masterEnabled: boolean,
    userPreferences: PreferenceRow[] = []
  ): string[] => resolver.resolve(def, { masterEnabled, userPreferences })

  describe('mandatory channels', () => {
    const def = makeDef({ mandatoryChannels: [NotificationChannel.IN_APP] })

    it('are always enabled even when the master toggle is off', () => {
      expect(resolve(def, false)).toEqual([NotificationChannel.IN_APP])
    })

    it('cannot be disabled by an explicit user preference', () => {
      const result = resolve(def, true, [
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        },
      ])

      expect(result).toContain(NotificationChannel.IN_APP)
    })
  })

  describe('master optional toggle', () => {
    it('disables all optional channels when off', () => {
      const def = makeDef({ defaultChannels: [NotificationChannel.IN_APP] })

      expect(resolve(def, false)).toEqual([])
    })

    it('enables default channels when on with no explicit preference', () => {
      const def = makeDef({ defaultChannels: [NotificationChannel.IN_APP] })

      expect(resolve(def, true)).toEqual([NotificationChannel.IN_APP])
    })
  })

  describe('explicit user preference', () => {
    it('opts into a supported non-default channel', () => {
      const def = makeDef({ defaultChannels: [NotificationChannel.IN_APP] })

      const result = resolve(def, true, [
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      ])

      expect(result).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL])
    })

    it('opts out of a default channel', () => {
      const def = makeDef({ defaultChannels: [NotificationChannel.IN_APP] })

      const result = resolve(def, true, [
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        },
      ])

      expect(result).toEqual([])
    })
  })

  describe('guards', () => {
    it('never enables a channel outside supportedChannels', () => {
      const def = makeDef({
        supportedChannels: [NotificationChannel.IN_APP],
        defaultChannels: [NotificationChannel.IN_APP],
      })

      const result = resolve(def, true, [
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      ])

      expect(result).toEqual([NotificationChannel.IN_APP])
    })

    it('ignores preferences for a different category', () => {
      const def = makeDef({ defaultChannels: [NotificationChannel.IN_APP] })

      const result = resolve(def, true, [
        {
          category: NotificationCategory.SECURITY,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        },
      ])

      expect(result).toEqual([NotificationChannel.IN_APP])
    })
  })
})
