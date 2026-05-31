/**
 * Object-key normalization + traversal guard.
 *
 * Every provider runs user-influenced keys through `normalizeObjectKey` before
 * any filesystem or S3 operation. It is intentionally strict: it normalizes the
 * obviously-safe shapes (collapse `//`, trim surrounding whitespace) and rejects
 * anything that could escape the intended prefix or break a provider.
 *
 * Never interpolate raw user filenames into keys — build keys from a trusted id
 * (`userId` / random id) plus a detected extension, then normalize.
 */

import { MAX_OBJECT_KEY_LENGTH } from './storage.constants'

/** Thrown when a key cannot be safely normalized. */
export class InvalidObjectKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid object key: ${reason}`)
    this.name = 'InvalidObjectKeyError'
  }
}

/**
 * Returns a safe, normalized object key or throws {@link InvalidObjectKeyError}.
 *
 * Accepts safe nested paths (`avatars/user-id/file.webp`). Rejects empty /
 * whitespace-only keys, leading slashes, backslashes, NUL / control chars, and
 * `.` / `..` path segments. Collapses duplicate slashes and trims surrounding
 * whitespace. Caps length at {@link MAX_OBJECT_KEY_LENGTH} UTF-8 bytes.
 */
export function normalizeObjectKey(input: string): string {
  if (typeof input !== 'string') {
    throw new InvalidObjectKeyError('key must be a string')
  }

  const trimmed = input.trim()

  if (trimmed.length === 0) {
    throw new InvalidObjectKeyError('key must not be empty or whitespace-only')
  }
  if (trimmed.startsWith('/')) {
    throw new InvalidObjectKeyError('key must not start with "/"')
  }
  if (trimmed.includes('\\')) {
    throw new InvalidObjectKeyError('key must not contain backslashes')
  }

  // Reject NUL and other control characters (checked by code point to avoid a
  // control-character regex literal, which ESLint's no-control-regex forbids).
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      throw new InvalidObjectKeyError('key must not contain control characters')
    }
  }

  // Collapse runs of slashes: `a//b` -> `a/b`.
  const collapsed = trimmed.replace(/\/{2,}/g, '/')

  // A trailing slash leaves an empty final segment (a "directory" key).
  if (collapsed.endsWith('/')) {
    throw new InvalidObjectKeyError('key must not end with "/"')
  }

  // Reject both `.` and `..` segments: under a local filesystem provider a
  // current-directory segment aliases the parent path (`a/./b` == `a/b`,
  // `.` == the storage root), so disallow them outright. A dot inside a
  // segment (`file.txt`, `.hidden`) is unaffected.
  for (const segment of collapsed.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new InvalidObjectKeyError('key must not contain "." or ".." path segments')
    }
  }

  if (Buffer.byteLength(collapsed, 'utf8') > MAX_OBJECT_KEY_LENGTH) {
    throw new InvalidObjectKeyError(`key exceeds ${MAX_OBJECT_KEY_LENGTH} bytes`)
  }

  return collapsed
}
