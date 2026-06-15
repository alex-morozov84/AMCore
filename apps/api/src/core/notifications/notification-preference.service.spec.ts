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

  describe('getPreferences', () => {
    it('returns the master toggle and per (category, channel) items with defaults', async () => {
      const result = await service.getPreferences('u1')

      expect(result.notificationsEnabled).toBe(true)
      expect(result.preferences).toContainEqual({
        category: NotificationCategory.ACCOUNT,
        channel: NotificationChannel.IN_APP,
        enabled: true,
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
      const mandatoryDef: NotificationDefinition = {
        type: 'security.alert',
        category: NotificationCategory.SECURITY,
        schemaVersion: 1,
        contentClass: NotificationContentClass.PUBLIC,
        supportedChannels: [NotificationChannel.IN_APP],
        defaultChannels: [NotificationChannel.IN_APP],
        mandatoryChannels: [NotificationChannel.IN_APP],
        externalModeByChannel: {},
        payloadSchema: z.object({}),
        safePayload: () => ({}),
        renderInApp: () => ({ title: 't', body: 'b' }),
      }
      const local = new NotificationPreferenceService(
        new NotificationDefinitionRegistry([mandatoryDef]),
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
  })

  describe('setMasterToggle', () => {
    it('delegates to the repository', async () => {
      await service.setMasterToggle('u1', false)

      expect(preferences.setMasterToggle).toHaveBeenCalledWith('u1', false)
    })
  })
})
