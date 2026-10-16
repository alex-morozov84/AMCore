/**
 * The public origin of the site (`WEB_SITE_ORIGIN`) and the indexing switch (`WEB_SEO_INDEXING`).
 *
 * Both are read from the server environment at request time, not compiled in: one built image
 * runs as staging (closed) and as production (open). Docs: `docs/frontend/seo.md`.
 */
type SeoEnvironment = Record<string, string | undefined>

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A canonical origin only: no path, query, hash or credentials, no trailing slash. `https`, or
 * `http` on a loopback host for local work. Anything else is `null`, so a typo can never put a
 * wrong absolute URL into canonical links or the sitemap.
 */
export function parseSiteOrigin(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== value || url.username || url.password) return null
  // `new URL` accepts a wildcard host such as `*.example.com`; a site origin must be one exact host.
  if (!/^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname !== '[::1]') return null
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url.origin
  return null
}

export function getSiteOrigin(env: SeoEnvironment = process.env): string | null {
  return parseSiteOrigin(env.WEB_SITE_ORIGIN)
}

/** `enabled` opens the site to search engines; unset, empty and `disabled` keep it closed. */
export function isIndexingEnabled(env: SeoEnvironment = process.env): boolean {
  return env.WEB_SEO_INDEXING?.trim() === 'enabled'
}

// Parsed exactly as the BFF origin guard parses it (`shared/api/bff/origin-guard.ts`): split, trim,
// nothing else. A looser parse (e.g. stripping a trailing slash) would pass this check while the
// guard still refuses the site's own browser requests.
function trustedOrigins(env: SeoEnvironment): string[] {
  return (env.WEB_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * Start-up check. A misconfiguration the operator asked for stops the service with a clear message
 * instead of silently serving a closed (or wrongly open) site:
 * - `WEB_SEO_INDEXING` is unset, empty, `enabled` or `disabled`; any other value is a typo.
 * - With `enabled`: `WEB_SITE_ORIGIN` is set, canonical, `https`, and one of `WEB_TRUSTED_ORIGINS`.
 * `disabled` never stops start-up, whatever `WEB_SITE_ORIGIN` holds: an unusable value is then
 * treated as unset and no absolute URL is emitted.
 */
export function assertSeoConfig(env: SeoEnvironment = process.env): void {
  const mode = env.WEB_SEO_INDEXING?.trim()
  if (mode && mode !== 'enabled' && mode !== 'disabled')
    throw new Error('WEB_SEO_INDEXING must be "enabled" or "disabled" (empty means disabled)')
  if (mode !== 'enabled') return
  const origin = getSiteOrigin(env)
  if (!origin || !origin.startsWith('https://'))
    throw new Error(
      'WEB_SEO_INDEXING=enabled requires WEB_SITE_ORIGIN to be a canonical https origin ' +
        '(no path, no trailing slash)'
    )
  if (!trustedOrigins(env).includes(origin))
    throw new Error('WEB_SITE_ORIGIN must also be listed in WEB_TRUSTED_ORIGINS')
}
