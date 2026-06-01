/**
 * Storage Service Types & Provider Contract
 *
 * Cloud-agnostic file storage. The same `StorageProvider` interface is
 * implemented by the s3 (production), local (dev), and memory (test) drivers
 * in later stages. Stage 1 defines only the contract + types.
 *
 * Design notes (locked in STORAGE_PLAN.md):
 * - Object-param method style for anything with optional fields, so call sites
 *   stay readable as the option set grows.
 * - `UploadResult` NEVER guarantees a URL. URLs are obtained explicitly via
 *   `getPublicUrl` (public-read objects only) or `getSignedDownloadUrl`.
 * - Private-by-default: omitting `visibility` means `private`.
 */

import type { Readable } from 'node:stream'

/**
 * Object access model. `private` (default) objects are reachable only via the
 * authenticated app or a time-limited signed URL; `public-read` objects get a
 * stable unauthenticated public URL (the avatar example is the one opt-in).
 */
export type Visibility = 'private' | 'public-read'

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface UploadInput {
  key: string
  body: Buffer | Readable
  contentType?: string
  contentDisposition?: string
  cacheControl?: string
  metadata?: Record<string, string>
  /** Defaults to `private` (see {@link Visibility}). */
  visibility?: Visibility
}

/**
 * Result of an upload. Deliberately carries NO URL — callers obtain one
 * explicitly via {@link StorageProvider.getPublicUrl} or
 * {@link StorageProvider.getSignedDownloadUrl}.
 */
export interface UploadResult {
  key: string
  size: number
  etag?: string
  contentType?: string
}

// ---------------------------------------------------------------------------
// Read / metadata
// ---------------------------------------------------------------------------

export interface FileMetadata {
  contentType?: string
  contentLength: number
  etag?: string
  lastModified?: Date
  /**
   * The local and memory drivers persist this so `public-read` vs `private` is
   * observable in e2e tests. May be absent on the s3 driver (S3 has no single
   * "visibility" field — it is derived from ACL/bucket policy).
   */
  visibility?: Visibility
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export interface SignedDownloadInput {
  key: string
  /** Seconds. Clamped server-side to `STORAGE_SIGNED_URL_MAX_TTL` (<= 604800). */
  expiresIn?: number
  /** Force e.g. `attachment; filename="..."` for user-supplied content. */
  contentDisposition?: string
  contentType?: string
}

export interface SignedUploadInput {
  key: string
  contentType?: string
  /** Seconds. Clamped server-side to `STORAGE_SIGNED_URL_MAX_TTL` (<= 604800). */
  expiresIn?: number
  // NOTE: bytes go client -> provider directly, so the server cannot
  // magic-byte-validate them. See the "presigned direct upload" security note
  // in STORAGE_PLAN.md — strong validation requires post-upload verification.
}

// ---------------------------------------------------------------------------
// Query / list
// ---------------------------------------------------------------------------

export interface ListInput {
  prefix: string
  maxKeys?: number
  continuationToken?: string
}

export interface FileInfo {
  key: string
  size: number
  lastModified?: Date
  etag?: string
}

export interface ListResult {
  files: FileInfo[]
  nextToken?: string
  isTruncated: boolean
}

// ---------------------------------------------------------------------------
// Copy / move
// ---------------------------------------------------------------------------

export interface CopyObjectInput {
  source: string
  destination: string
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Which optional URL families a driver supports. The `StorageService` facade
 * checks these and fails fast with a clear message rather than letting a driver
 * throw an opaque error (e.g. local/memory have both `false`).
 */
export interface StorageCapabilities {
  signedUrls: boolean
  publicUrls: boolean
}

// ---------------------------------------------------------------------------
// deleteMany partial-failure contract
// ---------------------------------------------------------------------------

/**
 * A single failed key from a `deleteMany` batch. Carries only the key and a
 * provider error code — never secrets or credential material.
 */
export interface StorageDeleteFailure {
  key: string
  code?: string
}

/**
 * Thrown by `deleteMany` when one or more keys fail. `deleteMany` attempts ALL
 * chunks first (best-effort), then throws this aggregate if anything failed.
 * It is NOT a partial-result return: a caller needing partial results would
 * require a `Promise<DeleteManyResult>` signature, which the starter does not
 * adopt.
 */
export class StorageDeleteManyException extends Error {
  constructor(readonly failures: StorageDeleteFailure[]) {
    super(`Failed to delete ${failures.length} object(s)`)
    this.name = 'StorageDeleteManyException'
  }
}

/**
 * Thrown by `download`, `downloadStream`, `getMetadata`, and `copy` (source)
 * when the object does not exist. Lets callers map a missing object to a 404
 * without an `exists` preflight (which costs an extra round-trip and can race).
 * `exists` itself never throws this — it returns `false`.
 */
export class StorageObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`)
    this.name = 'StorageObjectNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * The contract every storage driver implements. Methods take object params
 * where the plan calls for it (write / signed URLs / list / copy-move);
 * single-key reads stay positional.
 */
export interface StorageProvider {
  // Write
  upload(input: UploadInput): Promise<UploadResult>

  // Read
  download(key: string): Promise<Buffer>
  downloadStream(key: string): Promise<Readable>
  getMetadata(key: string): Promise<FileMetadata> // HEAD

  // Delete
  delete(key: string): Promise<void>
  /**
   * Delete many keys. Chunks to <= 1000/request for S3, attempts every chunk,
   * then throws {@link StorageDeleteManyException} if any key failed.
   */
  deleteMany(keys: string[]): Promise<void>

  // Query
  exists(key: string): Promise<boolean>
  list(input: ListInput): Promise<ListResult>

  // URLs
  getSignedDownloadUrl(input: SignedDownloadInput): Promise<string>
  getSignedUploadUrl(input: SignedUploadInput): Promise<string>
  /** Pure URL constructor for public-read objects ONLY — never the app-mediated download route. */
  getPublicUrl(key: string): string

  // Copy / move
  copy(input: CopyObjectInput): Promise<void>
  move(input: CopyObjectInput): Promise<void> // copy + delete

  // Capabilities
  readonly capabilities: StorageCapabilities
}
