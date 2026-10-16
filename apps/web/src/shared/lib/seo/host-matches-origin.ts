/**
 * Whether a request `Host` header names the same authority (host and port) as a canonical origin.
 *
 * Neutral on purpose: the Console host guard and the SEO indexing rule both need this one
 * comparison. Console imports it, never the other way round, because the Console files are
 * deleted whole when a fork disables the Console. Only the `Host` header is accepted by callers;
 * `X-Forwarded-Host` is client-controllable behind some proxies and is never read for this.
 * The comparison is case-exact: browsers send the host lowercase and the origin is canonical.
 */
export function hostMatchesOrigin(host: string | null | undefined, origin: string): boolean {
  return host === new URL(origin).host
}
