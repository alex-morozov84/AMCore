import { Injectable } from '@nestjs/common'

import { NOTIFICATION_DEFINITIONS } from './definitions'
import type { NotificationExternalMode } from './notification.constants'
import {
  DuplicateNotificationDefinitionError,
  UnknownNotificationTypeError,
} from './notification.errors'
import { resolveExternalMode } from './notification-content-policy'
import type {
  CategoryCapability,
  NotificationCapabilities,
  NotificationDefinition,
} from './notification-definition.types'
import { validateDefinition } from './notification-definition.validation'

/**
 * Registry of code-owned notification definitions (ADR-052). The single lookup
 * point a producer validates against; rejects duplicate types at construction so a
 * misconfiguration fails fast at bootstrap, not at send time.
 *
 * The default constructor loads the shipped `NOTIFICATION_DEFINITIONS`; tests
 * inject a custom set.
 */
@Injectable()
export class NotificationDefinitionRegistry {
  private readonly byType = new Map<string, NotificationDefinition>()

  constructor(definitions: readonly NotificationDefinition[] = NOTIFICATION_DEFINITIONS) {
    for (const definition of definitions) this.register(definition)
  }

  private register(definition: NotificationDefinition): void {
    validateDefinition(definition)
    if (this.byType.has(definition.type)) {
      throw new DuplicateNotificationDefinitionError(definition.type)
    }
    this.byType.set(definition.type, definition)
  }

  has(type: string): boolean {
    return this.byType.has(type)
  }

  /** Resolve a definition or throw `UnknownNotificationTypeError`. */
  get(type: string): NotificationDefinition {
    const definition = this.byType.get(type)
    if (!definition) throw new UnknownNotificationTypeError(type)
    return definition
  }

  list(): NotificationDefinition[] {
    return [...this.byType.values()]
  }

  /**
   * Validate a payload against its definition's schema, returning the parsed value.
   * Throws `UnknownNotificationTypeError` for an unknown type or `ZodError` for an
   * invalid payload (the producer maps these to a deterministic failure).
   */
  validatePayload(type: string, payload: unknown): unknown {
    return this.get(type).payloadSchema.parse(payload)
  }

  /** External exposure mode for a definition on a given channel (content policy). */
  externalMode(type: string, channel: string): NotificationExternalMode {
    return resolveExternalMode(this.get(type), channel)
  }

  /**
   * Aggregate the active channels and per-category channel sets across all
   * definitions — the single source for the capabilities and preferences surfaces.
   * Channel lists are sorted for a deterministic response.
   */
  capabilities(): NotificationCapabilities {
    const all = new Set<string>()
    const byCategory = new Map<
      string,
      { supported: Set<string>; default: Set<string>; mandatory: Set<string> }
    >()

    for (const definition of this.byType.values()) {
      const sets = byCategory.get(definition.category) ?? {
        supported: new Set<string>(),
        default: new Set<string>(),
        mandatory: new Set<string>(),
      }
      for (const channel of definition.supportedChannels) {
        sets.supported.add(channel)
        all.add(channel)
      }
      for (const channel of definition.defaultChannels) sets.default.add(channel)
      for (const channel of definition.mandatoryChannels) sets.mandatory.add(channel)
      byCategory.set(definition.category, sets)
    }

    const sorted = (set: Set<string>): string[] => [...set].sort()
    const categories: CategoryCapability[] = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, sets]) => ({
        category,
        supportedChannels: sorted(sets.supported),
        defaultChannels: sorted(sets.default),
        mandatoryChannels: sorted(sets.mandatory),
      }))

    return { channels: sorted(all), categories }
  }
}
