import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinition } from './notification-definition.types'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceService } from './notification-preference.service'

describe('NotificationPreferenceService', () => {
  let preferences: DeepMockProxy<NotificationPreferenceRepository>
  let service: NotificationPreferenceService

  beforeEach(() => {
    preferences = mockDeep<NotificationPreferenceRepository>()
    service = new NotificationPreferenceService(new NotificationDefinitionRegistry(), preferences)
    preferences.getMasterToggle.mockResolvedValue(true)
    preferences.findByUser.mockResolvedValue([])
  })

  const definition = (
    type: string,
    mandatoryChannels: NotificationChannel[]
  ): NotificationDefinition => ({
    type,
    category: NotificationCategory.SECURITY,
    schemaVersion: 1,
    contentClass: NotificationContentClass.PUBLIC,
    supportedChannels: [NotificationChannel.IN_APP],
    defaultChannels: [NotificationChannel.IN_APP],
    mandatoryChannels,
    externalModeByChannel: {},
    payloadSchema: z.object({}),
    safePayload: () => ({}),
    renderInApp: () => ({ title: 't', body: 'b' }),
  })

  describe('getPreferences', () => {
    it('returns the master toggle and per (category, channel) items with defaults', async () => {
      const result = await service.getPreferences('u1')

      expect(result.notificationsEnabled).toBe(true)
      // No stored override → enabled is null (definition defaults apply), not a
      // computed effective boolean.
      expect(result.preferences).toContainEqual({
        category: NotificationCategory.ACCOUNT,
        channel: NotificationChannel.IN_APP,
        enabled: null,
        mandatory: false,
      })
    })

    it('reflects an explicit user override', async () => {
      preferences.findByUser.mockResolvedValue([
        { category: 'account', channel: 'in_app', enabled: false },
      ] as never)

      const result = await service.getPreferences('u1')

      expect(result.preferences.find((p) => p.channel === 'in_app')?.enabled).toBe(false)
    })
  })

  describe('getCapabilities', () => {
    it('lists active and overridable channels', () => {
      const caps = service.getCapabilities()

      expect(caps.channels).toContain(NotificationChannel.IN_APP)
      const account = caps.categories.find((c) => c.category === NotificationCategory.ACCOUNT)
      expect(account?.channels).toContain(NotificationChannel.IN_APP)
      expect(account?.overridableChannels).toContain(NotificationChannel.IN_APP)
    })

    it('keeps a mixed mandatory/optional category overridable', () => {
      const local = new NotificationPreferenceService(
        new NotificationDefinitionRegistry([
          definition('security.mandatory', [NotificationChannel.IN_APP]),
          definition('security.optional', []),
        ]),
        preferences
      )

      const security = local
        .getCapabilities()
        .categories.find((item) => item.category === NotificationCategory.SECURITY)

      expect(security?.overridableChannels).toContain(NotificationChannel.IN_APP)
    })
  })

  describe('updatePreference', () => {
    it('upserts a valid overridable preference', async () => {
      await service.updatePreference('u1', {
        category: NotificationCategory.ACCOUNT,
        channel: NotificationChannel.IN_APP,
        enabled: false,
      })

      expect(preferences.upsertPreference).toHaveBeenCalledWith('u1', 'account', 'in_app', false)
    })

    it('rejects an unknown (category, channel) combination', async () => {
      await expect(
        service.updatePreference('u1', {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        })
      ).rejects.toThrow()
      expect(preferences.upsertPreference).not.toHaveBeenCalled()
    })

    it('rejects changing a mandatory channel', async () => {
      const local = new NotificationPreferenceService(
        new NotificationDefinitionRegistry([
          definition('security.mandatory', [NotificationChannel.IN_APP]),
        ]),
        preferences
      )

      await expect(
        local.updatePreference('u1', {
          category: NotificationCategory.SECURITY,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        })
      ).rejects.toThrow()
    })

    it('allows an override when at least one definition in the category is optional', async () => {
      const local = new NotificationPreferenceService(
        new NotificationDefinitionRegistry([
          definition('security.mandatory', [NotificationChannel.IN_APP]),
          definition('security.optional', []),
        ]),
        preferences
      )

      await local.updatePreference('u1', {
        category: NotificationCategory.SECURITY,
        channel: NotificationChannel.IN_APP,
        enabled: false,
      })

      expect(preferences.upsertPreference).toHaveBeenCalledWith(
        'u1',
        NotificationCategory.SECURITY,
        NotificationChannel.IN_APP,
        false
      )
    })
  })

  describe('setMasterToggle', () => {
    it('delegates to the repository', async () => {
      await service.setMasterToggle('u1', false)

      expect(preferences.setMasterToggle).toHaveBeenCalledWith('u1', false)
    })
  })
})
