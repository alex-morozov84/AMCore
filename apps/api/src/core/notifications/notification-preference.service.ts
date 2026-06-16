import { Injectable } from '@nestjs/common'

import type {
  NotificationCapabilitiesResponse,
  NotificationPreferenceItem,
  NotificationPreferencesResponse,
  UpdateNotificationPreferenceInput,
} from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions'

import { NotificationDefinitionRegistry } from './notification-definition.registry'
import { NotificationPreferenceRepository } from './notification-preference.repository'

/**
 * Builds the user-facing preferences/capabilities views and applies preference
 * writes, aggregating per-(category, channel) over the registry definitions (A.6).
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly preferences: NotificationPreferenceRepository
  ) {}

  async getPreferences(userId: string): Promise<NotificationPreferencesResponse> {
    const [notificationsEnabled, stored] = await Promise.all([
      this.preferences.getMasterToggle(userId),
      this.preferences.findByUser(userId),
    ])
    const storedByKey = new Map(
      stored.map((row) => [`${row.category}:${row.channel}`, row.enabled])
    )

    const items: NotificationPreferenceItem[] = []
    for (const category of this.registry.capabilities().categories) {
      const mandatory = new Set(category.mandatoryChannels)
      for (const channel of category.supportedChannels) {
        const key = `${category.category}:${channel}`
        items.push({
          category: category.category,
          channel,
          // The stored user override, or null when none exists (definition defaults
          // apply). NOT a computed effective boolean — see ADR-052 preferences model.
          enabled: storedByKey.has(key) ? (storedByKey.get(key) ?? null) : null,
          mandatory: mandatory.has(channel),
        })
      }
    }

    return { notificationsEnabled, preferences: items }
  }

  getCapabilities(): NotificationCapabilitiesResponse {
    const capabilities = this.registry.capabilities()
    return {
      channels: capabilities.channels,
      categories: capabilities.categories.map((category) => ({
        category: category.category,
        channels: category.supportedChannels,
        overridableChannels: category.overridableChannels,
      })),
    }
  }

  async updatePreference(userId: string, input: UpdateNotificationPreferenceInput): Promise<void> {
    const category = this.registry
      .capabilities()
      .categories.find((entry) => entry.category === input.category)

    if (!category || !category.supportedChannels.includes(input.channel)) {
      throw new BadRequestException('Unknown notification (category, channel) combination')
    }
    // Accept only if the override can affect at least one optional definition; a
    // channel mandatory in every definition of the category cannot be overridden.
    if (!category.overridableChannels.includes(input.channel)) {
      throw new BadRequestException(
        'This channel is mandatory for every notification in this category and cannot be overridden'
      )
    }

    await this.preferences.upsertPreference(userId, input.category, input.channel, input.enabled)
  }

  async setMasterToggle(userId: string, enabled: boolean): Promise<void> {
    await this.preferences.setMasterToggle(userId, enabled)
  }
}
