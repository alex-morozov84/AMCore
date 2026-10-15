import { randomBytes } from 'node:crypto'

import { normalizeObjectKey, PUBLIC_KEY_PREFIX } from '../storage/index.js'

import { OUTPUT_EXT } from './media.constants.js'
import type { ImageOutputFormat } from './media.types.js'

/**
 * Generate a per-upload version token for cache-busting derivative keys. base36
 * time prefix + random hex — key-safe (`[A-Za-z0-9_-]+`), unique per upload, and
 * roughly sortable. Used as the `v-<version>/` segment so immutable cache headers
 * are safe and old versions can be swept by prefix.
 */
export function generateUploadVersion(): string {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

export interface DerivativeKeyParts {
  /** Preset namespace/prefix, e.g. `avatars`. */
  keyspace: string
  /** Owner/subject scope. */
  ownerId: string
  /** Optional per-upload version segment for cache-busting (rendered `v-<version>`). */
  version?: string
  /** Variant name (e.g. `avatar-256`). */
  variant: string
  format: ImageOutputFormat
  /**
   * `public-read` derivatives live under the reserved public namespace so a bucket or
   * prefix the operator publishes never contains the private originals. Default `private`.
   */
  visibility?: 'private' | 'public-read'
}

/** A single key segment: alphanumerics, `_`, `-` only — no `/`, `.`, `:`, space. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

/**
 * Caller-supplied parts must each be exactly ONE safe path segment. `normalizeObjectKey`
 * alone blocks traversal/control chars but would still accept nested segments
 * (e.g. `ownerId: 'u1/other'`, `version: 'a/b'`), which would silently change the
 * key shape and break Stage 3's `v-<version>/` prefix cleanup.
 */
function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label} "${value}" for derivative key: must match [A-Za-z0-9_-]+`)
  }
}

/**
 * Build a deterministic derivative object key. Without `version` the key is
 * stable (re-running overwrites in place — idempotent). With `version` a
 * `v-<version>/` segment is inserted so immutable cache headers are safe and old
 * versions can be swept by prefix. `ownerId`/`version` are constrained to a
 * single safe segment; the whole key still passes the storage key guard.
 */
export function buildDerivativeKey(parts: DerivativeKeyParts): string {
  assertSafeSegment(parts.ownerId, 'ownerId')
  if (parts.version !== undefined) assertSafeSegment(parts.version, 'version')

  const versionSegment = parts.version ? `v-${parts.version}/` : ''
  const namespace = parts.visibility === 'public-read' ? PUBLIC_KEY_PREFIX : ''
  const key = `${namespace}${parts.keyspace}/${parts.ownerId}/${versionSegment}${parts.variant}.${OUTPUT_EXT[parts.format]}`
  return normalizeObjectKey(key)
}
