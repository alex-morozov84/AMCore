import { Injectable } from '@nestjs/common'

import type { SupportedLocale } from '@amcore/shared'

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
  RenderedNotificationContent,
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
      { supported: Set<string>; overridable: Set<string>; mandatory: Set<string> }
    >()

    for (const definition of this.byType.values()) {
      const sets = byCategory.get(definition.category) ?? {
        supported: new Set<string>(),
        overridable: new Set<string>(),
        mandatory: new Set<string>(),
      }
      const mandatory = new Set(definition.mandatoryChannels)
      for (const channel of definition.supportedChannels) {
        sets.supported.add(channel)
        all.add(channel)
        // Optional in THIS definition → a user override can affect it somewhere.
        if (!mandatory.has(channel)) sets.overridable.add(channel)
      }
      for (const channel of definition.mandatoryChannels) sets.mandatory.add(channel)
      byCategory.set(definition.category, sets)
    }

    const sorted = (set: Set<string>): string[] => [...set].sort()
    const categories: CategoryCapability[] = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, sets]) => ({
        category,
        supportedChannels: sorted(sets.supported),
        overridableChannels: sorted(sets.overridable),
        mandatoryChannels: sorted(sets.mandatory),
      }))

    return { channels: sorted(all), categories }
  }

  /**
   * Render a STORED notification for the feed, resolved by `(type, schemaVersion)`
   * and fail-closed PER ROW (ADR-052): an unknown type, a schemaVersion this build no
   * longer renders, an invalid historical payload, or a throwing renderer all fall
   * back to a neutral item rather than failing the whole feed page.
   *
   * Extension rule: changing a definition's payload schema requires bumping
   * `schemaVersion` and retaining a renderer/migrator for older versions within the
   * retention window (a fork adds version-aware rendering here).
   */
  renderStored(
    type: string,
    schemaVersion: number,
    payload: unknown,
    locale: SupportedLocale
  ): RenderedNotificationContent {
    const fallback: RenderedNotificationContent = { title: type, body: '' }
    const definition = this.byType.get(type)
    if (!definition || definition.schemaVersion !== schemaVersion) return fallback

    const parsed = definition.payloadSchema.safeParse(payload)
    if (!parsed.success) return fallback

    try {
      return definition.renderInApp(parsed.data, locale)
    } catch {
      return fallback
    }
  }
}
