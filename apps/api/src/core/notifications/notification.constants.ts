/** Backend-owned identifiers; persisted channel/category columns remain open strings. */

/** Built-in identifiers; custom channel IDs are validated by registration. */
export const NotificationChannel = {
  IN_APP: 'in_app',
  EMAIL: 'email',
  TELEGRAM: 'telegram',
} as const
// eslint-disable-next-line @typescript-eslint/no-redeclare -- value identifiers and open type share the public name
export type NotificationChannel = string

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
