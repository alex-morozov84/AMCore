import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'
import { InvalidNotificationDefinitionError } from './notification.errors'
import { resolveExternalMode } from './notification-content-policy'
import type { NotificationDefinition } from './notification-definition.types'

const TYPE_GRAMMAR = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const KNOWN_CHANNELS = new Set<string>(Object.values(NotificationChannel))
const KNOWN_CATEGORIES = new Set<string>(Object.values(NotificationCategory))

/**
 * Validate a definition's structural invariants at registration (ADR-052). Beyond
 * unique types, the registry must reject a misconfigured definition deterministically
 * at bootstrap rather than fail at send time: bad identifiers, `schemaVersion < 1`,
 * unknown/duplicate channels, mandatory channels outside defaults, `SECRET` content
 * (forbidden in the subsystem), or a detailed external channel with no allowlisted
 * `projectExternal`.
 */
export function validateDefinition(definition: NotificationDefinition): void {
  const fail = (reason: string): never => {
    throw new InvalidNotificationDefinitionError(definition.type, reason)
  }

  if (!TYPE_GRAMMAR.test(definition.type)) fail('type must match the dotted identifier grammar')
  if (!KNOWN_CATEGORIES.has(definition.category)) fail(`unknown category "${definition.category}"`)
  if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    fail('schemaVersion must be an integer >= 1')
  }
  if (definition.contentClass === NotificationContentClass.SECRET) {
    fail('SECRET content is forbidden in the notifications subsystem')
  }

  assertChannelSet(definition.defaultChannels, 'defaultChannels', fail)
  assertChannelSet(definition.mandatoryChannels, 'mandatoryChannels', fail)

  const defaults = new Set<string>(definition.defaultChannels)
  for (const channel of definition.mandatoryChannels) {
    if (!defaults.has(channel)) fail(`mandatory channel "${channel}" is not in defaultChannels`)
  }

  for (const channel of new Set<string>([
    ...definition.defaultChannels,
    ...definition.mandatoryChannels,
  ])) {
    if (channel === NotificationChannel.IN_APP) continue
    if (resolveExternalMode(definition, channel) === 'detailed' && !definition.projectExternal) {
      fail(
        `channel "${channel}" resolves to detailed external exposure but defines no projectExternal`
      )
    }
  }
}

function assertChannelSet(
  channels: readonly string[],
  field: string,
  fail: (reason: string) => never
): void {
  const seen = new Set<string>()
  for (const channel of channels) {
    if (!KNOWN_CHANNELS.has(channel)) fail(`${field} contains unknown channel "${channel}"`)
    if (seen.has(channel)) fail(`${field} contains duplicate channel "${channel}"`)
    seen.add(channel)
  }
}
