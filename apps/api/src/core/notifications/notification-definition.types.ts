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

/** Aggregated, channel-set view of one category across its definitions. */
export interface CategoryCapability {
  category: string
  /** Every channel any definition in this category may use. */
  supportedChannels: string[]
  /** Channels optional in at least one definition — a user override is meaningful. */
  overridableChannels: string[]
  /** Channels mandatory in at least one definition — those deliveries bypass the override. */
  mandatoryChannels: string[]
}

/** What channels/categories the subsystem currently supports (capabilities surface). */
export interface NotificationCapabilities {
  channels: string[]
  categories: CategoryCapability[]
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

  /**
   * The full set of channels this definition may EVER be delivered on. Preference
   * resolution can only enable a channel listed here — a user opt-in cannot select
   * an unsupported channel the definition can neither render nor safely expose.
   * Invariant: `mandatoryChannels ⊆ defaultChannels ⊆ supportedChannels`.
   */
  readonly supportedChannels: readonly NotificationChannel[]
  /** Channels selected when the user has no explicit preference. */
  readonly defaultChannels: readonly NotificationChannel[]
  /** Channels the user cannot disable. Must be a subset of `defaultChannels`. */
  readonly mandatoryChannels: readonly NotificationChannel[]
  /** Per-channel external exposure override; absent → derived from `contentClass`. */
  readonly externalModeByChannel: Partial<Record<NotificationChannel, 'detailed' | 'generic'>>

  /** Runtime payload validation (language-neutral, no rendered text, no secrets). */
  readonly payloadSchema: ZodType<TPayload>

  /** Safe public projection of the payload for the recipient's own in-app feed. */
  safePayload(payload: TPayload): Record<string, unknown>
  /** In-app feed render in the recipient's locale. */
  renderInApp(payload: TPayload, locale: SupportedLocale): RenderedNotificationContent
  /**
   * Detailed email title/body in the recipient's locale, used ONLY when the content
   * policy resolves email to `detailed` (PUBLIC, or an explicit per-channel override).
   * Separate from `renderInApp` because email copy has different length/CTA/sensitivity
   * constraints. When absent, the dispatcher falls back to a neutral generic email.
   */
  renderEmail?(payload: TPayload, locale: SupportedLocale): RenderedNotificationContent
  /** Optional safe first-party action descriptor (never an arbitrary URL). */
  action?(payload: TPayload): NotificationAction | null

  /**
   * Per-channel allowlisted projection for an external channel resolved to
   * `detailed` (ADR-052: PERSONAL details only via an explicit field-and-channel
   * allowlist). REQUIRED — validated at registration — for any **supported** external
   * channel whose resolved mode is `detailed` (supported, not just default, because a
   * user opt-in can enable any supported channel). A `generic` channel never calls
   * this and receives no raw payload. Returning the fields for that specific channel
   * makes the allowlist provable, instead of one global projection leaking everywhere.
   */
  projectExternal?(channel: NotificationChannel, payload: TPayload): Record<string, unknown>
}
