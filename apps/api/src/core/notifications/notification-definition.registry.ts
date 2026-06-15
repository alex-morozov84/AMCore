import { Injectable } from '@nestjs/common'

import { NOTIFICATION_DEFINITIONS } from './definitions'
import type { NotificationExternalMode } from './notification.constants'
import {
  DuplicateNotificationDefinitionError,
  UnknownNotificationTypeError,
} from './notification.errors'
import { resolveExternalMode } from './notification-content-policy'
import type { NotificationDefinition } from './notification-definition.types'

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
}
