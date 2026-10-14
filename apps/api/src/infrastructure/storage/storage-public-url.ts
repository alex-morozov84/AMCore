import { InvalidObjectKeyError, normalizeObjectKey } from './object-key'
import { isPublicKey, PUBLIC_KEY_PREFIX } from './storage-namespace'

function assertPublicKey(key: string): string {
  const normalized = normalizeObjectKey(key)
  if (!isPublicKey(normalized)) {
    throw new InvalidObjectKeyError(
      `a public URL exists only for keys under "${PUBLIC_KEY_PREFIX}"; this key is private`
    )
  }
  return normalized
}

/**
 * URL of a public object served from the root of a bucket or CDN origin:
 * `<base>/<key>` with every path segment percent-encoded. `base` is the URL that
 * maps to the bucket root (CDN, custom domain, provider public domain). Nothing
 * is synthesized from the SDK endpoint or the bucket name.
 */
export function buildBucketRootUrl(base: string, key: string): string {
  const path = assertPublicKey(key).split('/').map(encodeURIComponent).join('/')
  return `${base.replace(/\/+$/, '')}/${path}`
}

/** URL of a public object served by the API public route: `<base>?key=<encoded key>`. */
export function buildPublicRouteUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}?key=${encodeURIComponent(assertPublicKey(key))}`
}
