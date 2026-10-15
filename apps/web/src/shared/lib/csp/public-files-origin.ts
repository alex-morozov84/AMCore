/**
 * The one origin the browser may load public files (avatars) from, besides the web origin itself.
 * It comes from `WEB_PUBLIC_FILES_ORIGIN` and feeds the CSP `img-src` directive. Anything that is
 * not a plain `https` origin (or a loopback `http` origin, for local stands) is dropped, so a typo
 * or a wildcard can never widen the policy: the result is a single exact origin or `null`.
 */
export function parsePublicFilesOrigin(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  // `new URL` accepts a wildcard host such as `*.example.com`; a CSP source must be an exact host.
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return null
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.origin
  return null
}

/** Read the configured origin from the server environment. */
export function getPublicFilesOrigin(): string | null {
  return parsePublicFilesOrigin(process.env.WEB_PUBLIC_FILES_ORIGIN)
}

/**
 * Start-up check: a set but unusable value is a configuration error, not a quiet fallback, so an
 * operator who writes `http://cdn.example.com` learns at boot instead of finding broken avatars.
 * The proxy keeps the lenient `getPublicFilesOrigin`, which can only ever narrow the policy.
 */
export function assertPublicFilesOrigin(
  env: Record<string, string | undefined> = process.env
): void {
  const raw = env.WEB_PUBLIC_FILES_ORIGIN?.trim()
  if (raw && parsePublicFilesOrigin(raw) === null)
    throw new Error(
      'WEB_PUBLIC_FILES_ORIGIN must be an https origin (or a loopback http origin) without credentials or wildcards'
    )
}
