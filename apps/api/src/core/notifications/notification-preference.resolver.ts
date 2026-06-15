import { Injectable } from '@nestjs/common'

import type { NotificationChannel } from './notification.constants'
import type { NotificationDefinition } from './notification-definition.types'

/** A stored user preference row (structurally compatible with the Prisma model). */
export interface PreferenceRow {
  category: string
  channel: string
  enabled: boolean
}

export interface ChannelResolutionInput {
  /** Master optional toggle (`UserSettings.notificationsEnabled`). */
  masterEnabled: boolean
  /** The user's explicit `(category, channel)` preferences (any category). */
  userPreferences: readonly PreferenceRow[]
}

/**
 * Resolves which channels a notification is delivered on (ADR-052 resolution order):
 *
 * 1. mandatory channels — always on (bypass the master toggle and any user pref);
 * 2. master optional toggle off → no optional channel is enabled;
 * 3. explicit user `(category, channel)` preference;
 * 4. definition default.
 *
 * Only `supportedChannels` are ever considered, so a stale/forged preference for an
 * unsupported channel can never enable it.
 */
@Injectable()
export class NotificationPreferenceResolver {
  resolve(
    definition: NotificationDefinition,
    input: ChannelResolutionInput
  ): NotificationChannel[] {
    const categoryPreferences = new Map<string, boolean>()
    for (const pref of input.userPreferences) {
      if (pref.category === definition.category) categoryPreferences.set(pref.channel, pref.enabled)
    }

    const mandatory = new Set<string>(definition.mandatoryChannels)
    const defaults = new Set<string>(definition.defaultChannels)
    const enabled: NotificationChannel[] = []

    for (const channel of definition.supportedChannels) {
      if (mandatory.has(channel)) {
        enabled.push(channel)
        continue
      }
      if (!input.masterEnabled) continue
      if (categoryPreferences.get(channel) ?? defaults.has(channel)) enabled.push(channel)
    }

    return enabled
  }
}
