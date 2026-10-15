import { InvalidObjectKeyError, normalizeObjectKey } from './object-key.js'
import { isPublicKey, PUBLIC_KEY_PREFIX } from './storage-namespace.js'

/** How a public address is formed: under a bucket root, or as the API public route's query. */
export type PublicUrlForm = 'bucket-root' | 'route'

function assertPublicKey(key: string): string {
  const normalized = normalizeObjectKey(key)
  if (!isPublicKey(normalized)) {
    throw new InvalidObjectKeyError(
      `a public URL exists only for keys under "${PUBLIC_KEY_PREFIX}"; this key is private`
    )
  }
  return normalized
}

function form(urlForm: PublicUrlForm, base: string, key: string): string {
  const root = base.replace(/\/+$/, '')
  return urlForm === 'route'
    ? `${root}?key=${encodeURIComponent(key)}`
    : `${root}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * URL of a public object served from the root of a bucket or CDN origin:
 * `<base>/<key>` with every path segment percent-encoded. `base` is the URL that
 * maps to the bucket root (CDN, custom domain, provider public domain). Nothing
 * is synthesized from the SDK endpoint or the bucket name.
 */
export function buildBucketRootUrl(base: string, key: string): string {
  return form('bucket-root', base, assertPublicKey(key))
}

/** URL of a public object served by the API public route: `<base>?key=<encoded key>`. */
export function buildPublicRouteUrl(base: string, key: string): string {
  return form('route', base, assertPublicKey(key))
}

/**
 * The address a client would use for ANY key in the given form, including a private one the
 * application never publishes. Only the delivery check uses it, to prove that the public
 * base refuses such a key; it must never reach a user.
 */
export function buildDiagnosticUrl(urlForm: PublicUrlForm, base: string, key: string): string {
  return form(urlForm, base, normalizeObjectKey(key))
}
