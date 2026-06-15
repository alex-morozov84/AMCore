import type { ZodType } from 'zod'

import type { NotificationAction, SupportedLocale } from '@amcore/shared'

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'

/** Server-rendered, localized in-app content. */
export interface RenderedNotificationContent {
  title: string
  body: string
}

/**
 * A code-owned notification definition (ADR-052). Each notification type declares
 * its category, payload contract, channel policy, content classification, and how
 * to render/expose itself — the single source of truth a producer validates against.
 */
export interface NotificationDefinition<TPayload = unknown> {
  /** Namespaced event key, e.g. `account.profile_updated`. */
  readonly type: string
  readonly category: NotificationCategory
  readonly schemaVersion: number
  readonly contentClass: NotificationContentClass

  /** Channels selected when the user has no explicit preference. */
  readonly defaultChannels: readonly NotificationChannel[]
  /** Channels the user cannot disable. Must be a subset of `defaultChannels`. */
  readonly mandatoryChannels: readonly NotificationChannel[]
  /** Per-channel external exposure override; absent → derived from `contentClass`. */
  readonly externalModeByChannel: Partial<Record<NotificationChannel, 'detailed' | 'generic'>>

  /** Runtime payload validation (language-neutral, no rendered text, no secrets). */
  readonly payloadSchema: ZodType<TPayload>

  /** Safe public projection of the payload (no secrets) for renderers/clients. */
  safePayload(payload: TPayload): Record<string, unknown>
  /** In-app feed render in the recipient's locale. */
  renderInApp(payload: TPayload, locale: SupportedLocale): RenderedNotificationContent
  /** Optional safe first-party action descriptor (never an arbitrary URL). */
  action?(payload: TPayload): NotificationAction | null
}
