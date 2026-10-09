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
const KNOWN_CONTENT_CLASSES = new Set<string>(Object.values(NotificationContentClass))
const KNOWN_CATEGORIES = new Set<string>(Object.values(NotificationCategory))

/**
 * Validate a definition's structural invariants at registration (ADR-052). Beyond
 * unique types, the registry must reject a misconfigured definition deterministically
 * at bootstrap rather than fail at send time: bad identifiers, `schemaVersion < 1`,
 * unknown/duplicate channels, mandatory channels outside defaults, `SECRET` content
 * (forbidden in the subsystem), or a detailed external channel with no allowlisted
 * `projectExternal` and callable channel renderer.
 */
export function validateDefinition(
  definition: NotificationDefinition,
  channelIds: readonly string[] = [...KNOWN_CHANNELS]
): void {
  const fail = (reason: string): never => {
    throw new InvalidNotificationDefinitionError(definition.type, reason)
  }

  if (!TYPE_GRAMMAR.test(definition.type)) fail('type must match the dotted identifier grammar')
  if (!KNOWN_CATEGORIES.has(definition.category)) fail(`unknown category "${definition.category}"`)
  if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    fail('schemaVersion must be an integer >= 1')
  }
  if (!KNOWN_CONTENT_CLASSES.has(definition.contentClass)) fail('unknown contentClass')
  if (
    !definition.externalModeByChannel ||
    typeof definition.externalModeByChannel !== 'object' ||
    Array.isArray(definition.externalModeByChannel)
  )
    fail('invalid external policy')
  for (const [channel, mode] of Object.entries(definition.externalModeByChannel)) {
    if (!channelIds.includes(channel) || channel === NotificationChannel.IN_APP)
      fail('invalid external policy channel')
    if (mode !== 'generic' && mode !== 'detailed') fail('invalid external exposure mode')
  }
  if (definition.contentClass === NotificationContentClass.SECRET) {
    fail('SECRET content is forbidden in the notifications subsystem')
  }

  assertChannelSet(definition.supportedChannels, 'supportedChannels', fail, channelIds)
  assertChannelSet(definition.defaultChannels, 'defaultChannels', fail, channelIds)
  assertChannelSet(definition.mandatoryChannels, 'mandatoryChannels', fail, channelIds)

  // mandatory ⊆ default ⊆ supported.
  const supported = new Set<string>(definition.supportedChannels)
  for (const channel of definition.defaultChannels) {
    if (!supported.has(channel)) fail(`default channel "${channel}" is not in supportedChannels`)
  }
  const defaults = new Set<string>(definition.defaultChannels)
  for (const channel of definition.mandatoryChannels) {
    if (!defaults.has(channel)) fail(`mandatory channel "${channel}" is not in defaultChannels`)
  }

  // Every supported external channel that resolves to detailed must have a
  // projection and renderer — a user opt-in can enable any supported channel, not only defaults.
  for (const channel of supported) {
    if (channel === NotificationChannel.IN_APP) continue
    const mode = resolveExternalMode(definition, channel)
    if (mode !== 'generic' && mode !== 'detailed')
      fail(`channel "${channel}" has invalid resolved policy`)
    if (mode === 'generic') continue
    if (typeof definition.projectExternal !== 'function')
      fail(`channel "${channel}" defines no projectExternal`)
    if (typeof definition.renderExternal?.[channel] !== 'function')
      fail(`channel "${channel}" defines no detailed renderer`)
  }
}

function assertChannelSet(
  channels: readonly string[],
  field: string,
  fail: (reason: string) => never,
  channelIds: readonly string[]
): void {
  const seen = new Set<string>()
  for (const channel of channels) {
    if (!channelIds.includes(channel)) fail(`${field} contains unknown channel "${channel}"`)
    if (seen.has(channel)) fail(`${field} contains duplicate channel "${channel}"`)
    seen.add(channel)
  }
}
