import { isIP } from 'node:net'

import 'server-only'

// Which inbound header apps/web should trust as the real visitor IP, set by
// whatever edge (nginx/Caddy/a cloud LB) terminates TLS in front of
// apps/web itself — never the browser (ADR-072). Unlike apps/api's
// TRUST_PROXY (ADR-060), Next.js Route Handlers/Proxy expose no raw socket
// address to verify a hop's real identity against — there is no such API in
// the installed Next.js docs (confirmed during ADR-072's research). So this
// is trust-by-header-name only: enabling it is the operator asserting their
// own edge overwrites (never appends to) the named header before it
// reaches apps/web, the same way `docs/operations/deployment.md` already
// requires of any edge in front of apps/api. Default unset = disabled, so a
// fresh checkout never trusts any inbound header until an operator opts in.
const ALLOWED_HEADERS = new Set([
  'x-real-ip',
  'x-forwarded-for',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
])

function resolveConfiguredHeader(): string | null {
  const raw = process.env.WEB_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase()
  if (!raw) return null
  if (!ALLOWED_HEADERS.has(raw)) {
    throw new Error(
      `WEB_TRUSTED_CLIENT_IP_HEADER: unsupported header "${raw}" - expected one of ` +
        `${[...ALLOWED_HEADERS].sort().join(', ')}`
    )
  }
  return raw
}

/**
 * Derives the real visitor IP from the configured trusted inbound header,
 * or `null` when disabled/absent/malformed — the safe default, under which
 * `apps/api` simply falls back to its own `req.ip` for this hop, exactly
 * today's (pre-ADR-072) behavior. Throws if `WEB_TRUSTED_CLIENT_IP_HEADER`
 * is set to an unrecognized value, the same fail-loudly-on-typo discipline
 * `TRUST_PROXY` uses on the API side (ADR-060).
 */
export function resolveTrustedClientIp(headers: Headers): string | null {
  const header = resolveConfiguredHeader()
  if (!header) return null

  const raw = headers.get(header)
  if (!raw) return null

  // X-Forwarded-For may carry a comma-separated chain; the first entry is
  // the client position when the trusted edge overwrites the header itself
  // rather than appending to a client-supplied one.
  const candidate = raw.split(',')[0]?.trim()
  if (!candidate || isIP(candidate) === 0) return null

  return candidate
}
