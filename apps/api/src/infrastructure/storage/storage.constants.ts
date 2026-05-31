/**
 * Storage module constants — injection tokens and shared defaults.
 *
 * Stage 1 (interface + types + env) only. Providers, service, and module
 * wiring arrive in later stages; nothing here imports the AWS SDK or NestJS
 * runtime so it stays safe to pull into the early `env.ts` validation path.
 */

import type { Visibility } from './storage.interface'

/**
 * Injection token for the active `StorageProvider`. The dynamic
 * `StorageModule` (later stage) binds this to the driver selected by
 * `STORAGE_DRIVER`; `StorageService` injects it.
 */
export const STORAGE_PROVIDER = Symbol('StorageProvider')

/** Supported storage drivers (mirrors the `STORAGE_DRIVER` env enum). */
export const STORAGE_DRIVERS = ['s3', 'local', 'memory'] as const
export type StorageDriver = (typeof STORAGE_DRIVERS)[number]

/**
 * Private-by-default (Decision A). Every upload without an explicit
 * `visibility` is `private`; `public-read` is an opt-in.
 */
export const DEFAULT_VISIBILITY: Visibility = 'private'

/**
 * Hard cap on a normalized object key length, in UTF-8 bytes. Matches the S3
 * key-length limit (1024 bytes) so a key accepted locally is portable to the
 * `s3` driver. Enforced by `normalizeObjectKey`.
 */
export const MAX_OBJECT_KEY_LENGTH = 1024

/**
 * S3 `DeleteObjects` caps at 1000 keys per request. `deleteMany` chunks into
 * batches no larger than this (used by the s3 provider in a later stage).
 */
export const S3_DELETE_OBJECTS_MAX_KEYS = 1000
