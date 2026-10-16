import { hostMatchesOrigin } from './host-matches-origin'
import { getSiteOrigin, isIndexingEnabled } from './site-origin'

type SeoEnvironment = Record<string, string | undefined>

/** The directive the proxy adds whenever the site is not open to search engines. */
export const NOINDEX_HEADER_VALUE = 'noindex, nofollow'

/**
 * Whether search engines may index this request. All of these must hold:
 * 1. `WEB_SEO_INDEXING=enabled`;
 * 2. `WEB_SITE_ORIGIN` is a usable origin;
 * 3. the request `Host` header equals that origin's host.
 * The third rule keeps the same built image closed on staging, previews, raw IP addresses, www or
 * apex aliases and the Console host. Only `Host` is read, never `X-Forwarded-Host`.
 */
export function isIndexingEffective(
  host: string | null | undefined,
  env: SeoEnvironment = process.env
): boolean {
  if (!isIndexingEnabled(env)) return false
  const origin = getSiteOrigin(env)
  return origin !== null && hostMatchesOrigin(host, origin)
}

/**
 * Proxy hook. It only ever SETS `X-Robots-Tag`, never removes or weakens it: Next applies the
 * `next.config.ts` `headers()` first and the proxy runs after, so a static header already on the
 * response (the Console, `/api`) must survive. When indexing is effective it does nothing, and the
 * page's own metadata decides (private pages are closed by the root `robots: noindex`).
 * Structural types keep this module free of `next/server`.
 */
export function applyIndexingPolicy(
  request: { headers: Pick<Headers, 'get'> },
  response: { headers: Pick<Headers, 'set'> }
): void {
  if (!isIndexingEffective(request.headers.get('host'))) {
    response.headers.set('X-Robots-Tag', NOINDEX_HEADER_VALUE)
  }
}
