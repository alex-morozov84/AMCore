/**
 * Backend-owned active notification channels and categories (Track B — ADR-052).
 *
 * These are TypeScript enums for ergonomic backend use — NOT Postgres enums: the
 * DB columns stay `String` so a new channel/category is additive. The shared
 * package validates the string *grammar*; this is the active set, surfaced to
 * clients via the capabilities response. Add new channels here when their adapter
 * ships (Telegram in Arc D, Web Push in the frontend phase) so the capabilities
 * surface never advertises a dead channel.
 */

export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
}

export enum NotificationCategory {
  SECURITY = 'security',
  ACCOUNT = 'account',
  ORGANIZATION = 'organization',
  PRODUCT = 'product',
}

/**
 * Content sensitivity classification governing external-channel exposure (ADR-052).
 * `SECRET` is forbidden in the durable subsystem entirely (reset/verification
 * tokens stay in the existing direct-email paths).
 */
export enum NotificationContentClass {
  PUBLIC = 'PUBLIC',
  PERSONAL = 'PERSONAL',
  SENSITIVE = 'SENSITIVE',
  SECRET = 'SECRET',
}

/**
 * How much a definition exposes to a given external channel:
 * - `detailed` — the full safe public projection;
 * - `generic` — a neutral "you have a new notification" summary + safe action;
 * - `forbidden` — the channel must not deliver this definition at all.
 */
export type NotificationExternalMode = 'detailed' | 'generic' | 'forbidden'
