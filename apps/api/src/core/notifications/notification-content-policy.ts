import { NotificationContentClass, type NotificationExternalMode } from './notification.constants'
import type { NotificationDefinition } from './notification-definition.types'

/**
 * Content exposure policy for external channels (ADR-052).
 *
 * The in-app channel always shows the full content; external channels (email,
 * Telegram, …) expose only what the classification allows, unless the definition
 * explicitly overrides per channel.
 */

/** Default external exposure derived from the content classification. */
export function defaultExternalMode(
  contentClass: NotificationContentClass
): NotificationExternalMode {
  switch (contentClass) {
    case NotificationContentClass.PUBLIC:
      return 'detailed'
    case NotificationContentClass.PERSONAL:
    case NotificationContentClass.SENSITIVE:
      return 'generic'
    case NotificationContentClass.SECRET:
      return 'forbidden'
  }
}

/**
 * Resolve how a definition should be exposed on a specific external channel: an
 * explicit per-channel override (only `detailed`/`generic` are expressible) wins,
 * otherwise the classification default — and `SECRET` is always `forbidden`.
 */
export function resolveExternalMode(
  definition: NotificationDefinition,
  channel: string
): NotificationExternalMode {
  if (definition.contentClass === NotificationContentClass.SECRET) return 'forbidden'
  const override =
    definition.externalModeByChannel[channel as keyof typeof definition.externalModeByChannel]
  return override ?? defaultExternalMode(definition.contentClass)
}
