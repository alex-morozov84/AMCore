import { InvalidObjectKeyError, normalizeObjectKey } from './object-key.js'
import { DEFAULT_VISIBILITY } from './storage.constants.js'
import type { Visibility } from './storage.interface.js'

/**
 * Reserved first key segment of every publicly readable object. The key IS the
 * visibility: a provider never has to guess from metadata, a bucket policy or an
 * ACL which objects the application meant to publish, and an operator publishes
 * exactly this namespace (a prefix policy, or a dedicated public bucket).
 */
export const PUBLIC_KEY_PREFIX = 'public/'

export function isPublicKey(key: string): boolean {
  return normalizeObjectKey(key).startsWith(PUBLIC_KEY_PREFIX)
}

/** Visibility implied by the key namespace; the single source of truth for every driver. */
export function visibilityOf(key: string): Visibility {
  return isPublicKey(key) ? 'public-read' : DEFAULT_VISIBILITY
}

/**
 * Resolve the visibility of an upload and reject a contradiction between the
 * requested visibility and the key namespace. Omitting `requested` follows the
 * key, so a `public/` key is public and every other key stays private.
 */
export function resolveUploadVisibility(key: string, requested?: Visibility): Visibility {
  const implied = visibilityOf(key)
  if (requested !== undefined && requested !== implied) {
    throw new InvalidObjectKeyError(
      implied === 'public-read'
        ? `keys under "${PUBLIC_KEY_PREFIX}" are public and cannot be uploaded as ${requested}`
        : `${requested} objects must use a key under "${PUBLIC_KEY_PREFIX}"`
    )
  }
  return implied
}

/** Copy and move never change visibility: both keys must be in the same namespace. */
export function assertSameNamespace(source: string, destination: string): void {
  if (isPublicKey(source) !== isPublicKey(destination)) {
    throw new InvalidObjectKeyError(
      `copy and move cannot cross the "${PUBLIC_KEY_PREFIX}" namespace; upload the object again through the validated path`
    )
  }
}

/**
 * Whether a list prefix lies inside the public namespace. A prefix that is only
 * a leading part of the namespace (`''`, `'pu'`) spans both and is ambiguous
 * when public and private objects live in different buckets.
 */
export function classifyListPrefix(prefix: string): 'public' | 'private' | 'ambiguous' {
  if (prefix.startsWith(PUBLIC_KEY_PREFIX)) return 'public'
  if (PUBLIC_KEY_PREFIX.startsWith(prefix)) return 'ambiguous'
  return 'private'
}
