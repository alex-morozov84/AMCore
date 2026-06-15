import { z, type ZodTypeAny } from 'zod'

import { PAGINATION } from '../constants'

/**
 * Notification API contracts (Track B — ADR-052 / ADR-053).
 *
 * Language-agnostic: no human-readable messages live here. Channel, category and
 * type are validated as **bounded strings** (not fixed enums) so a new channel
 * stays additive — the active set is owned by the backend definition registry and
 * surfaced at runtime via the capabilities response, never advertised as a dead
 * enum value (ADR-052).
 */

export const NOTIFICATION_IDENTIFIER_MAX_LENGTH = 64

/**
 * Flat identifier grammar for `channel` and `category` (e.g. `in_app`, `email`,
 * `security`): one lowercase segment.
 */
export const notificationChannelSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/)

export const notificationCategorySchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/)

/**
 * Dotted identifier grammar for `type` — a namespaced event key
 * (e.g. `account.password_changed`).
 */
export const notificationTypeSchema = z
  .string()
  .min(1)
  .max(NOTIFICATION_IDENTIFIER_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)

/**
 * Safe first-party action descriptor — a route key + bounded string params, never
 * an arbitrary URL. The client resolves `route` to an in-app destination.
 */
export const notificationActionSchema = z.object({
  route: z.string().min(1).max(128),
  params: z.record(z.string(), z.string()).optional(),
})

export type NotificationAction = z.infer<typeof notificationActionSchema>

/**
 * Keyset (cursor) feed query (ADR-036 endpoint-local exception). `cursor` is an
 * opaque versioned token encoding the last `(createdAt, id)`; `limit` reuses the
 * shared pagination bounds. No `page`/`total` — unread count is a separate endpoint.
 */
export const notificationFeedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
})

export type NotificationFeedQuery = z.infer<typeof notificationFeedQuerySchema>

/**
 * Cursor (keyset) response envelope. Distinct from the offset
 * `paginatedResponseSchema` (ADR-036): append-heavy feeds use `nextCursor`/`hasMore`.
 */
export const cursorResponseSchema = <T extends ZodTypeAny>(
  item: T
): z.ZodObject<{
  data: z.ZodArray<T>
  nextCursor: z.ZodNullable<z.ZodString>
  hasMore: z.ZodBoolean
}> =>
  z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })

export type CursorResponse<T> = {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Feed item. `title`/`body` are rendered server-side in the user's current locale
 * at read time (ADR-052) — the DB stores only the structured payload, never text.
 */
export const notificationFeedItemSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  category: notificationCategorySchema,
  title: z.string(),
  body: z.string(),
  action: notificationActionSchema.nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
})

export type NotificationFeedItem = z.infer<typeof notificationFeedItemSchema>

export const notificationFeedResponseSchema = cursorResponseSchema(notificationFeedItemSchema)

export type NotificationFeedResponse = CursorResponse<NotificationFeedItem>

/** Unread badge count (separate from the feed, exact). */
export const unreadCountResponseSchema = z.object({
  unread: z.number().int().nonnegative(),
})

export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>

/**
 * Mark-all-read result. Single mark-read and archive are 204 (no body); the
 * bulk endpoint reports how many rows changed.
 */
export const markAllReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
})

export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>

/**
 * One preference row in the read response. `mandatory` channels are locked: the
 * client renders them read-only and the server rejects an attempt to disable them.
 */
export const notificationPreferenceItemSchema = z.object({
  category: notificationCategorySchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  mandatory: z.boolean(),
})

export type NotificationPreferenceItem = z.infer<typeof notificationPreferenceItemSchema>

export const notificationPreferencesResponseSchema = z.object({
  /** Master optional toggle (mirrors `UserSettings.notificationsEnabled`). */
  notificationsEnabled: z.boolean(),
  preferences: z.array(notificationPreferenceItemSchema),
})

export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>

/** Update a single (category, channel) preference. Rejected for mandatory pairs. */
export const updateNotificationPreferenceSchema = z.object({
  category: notificationCategorySchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
})

export type UpdateNotificationPreferenceInput = z.infer<typeof updateNotificationPreferenceSchema>

/**
 * Capabilities — the active channels and, per category, its channels and which are
 * user-overridable. Only currently-implemented channels are listed (ADR-052: no
 * dead capability is advertised).
 */
export const notificationCategoryCapabilitySchema = z.object({
  category: notificationCategorySchema,
  channels: z.array(notificationChannelSchema),
  overridableChannels: z.array(notificationChannelSchema),
})

export const notificationCapabilitiesResponseSchema = z.object({
  channels: z.array(notificationChannelSchema),
  categories: z.array(notificationCategoryCapabilitySchema),
})

export type NotificationCapabilitiesResponse = z.infer<
  typeof notificationCapabilitiesResponseSchema
>

/**
 * Realtime SSE invalidation event (ADR-053) — a disposable hint carrying no
 * rendered content or destination. The client refetches the durable feed/unread
 * state by reason; a missed event is repaired on the next reconnect.
 */
export const NOTIFICATION_SSE_REASONS = ['created', 'read', 'archived', 'unread_changed'] as const

export const notificationSseEventSchema = z.object({
  eventId: z.string(),
  reason: z.enum(NOTIFICATION_SSE_REASONS),
  notificationId: z.string().optional(),
})

export type NotificationSseReason = (typeof NOTIFICATION_SSE_REASONS)[number]
export type NotificationSseEvent = z.infer<typeof notificationSseEventSchema>
