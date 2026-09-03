// The internal, verified-peer-gated client-IP signal (ADR-072) `apps/web`
// sets on its own outgoing request — never something a browser is allowed
// to set directly. Exported so the trusted-inbound-IP resolver (ADR-072
// item 3) and any consumer can reference the same name instead of
// duplicating the literal.
export const AMCORE_CLIENT_IP_HEADER = 'x-amcore-client-ip'

// Hop-by-hop / connection-specific — meaningless or wrong to replay verbatim
// on a new outgoing request. `origin`/`referer` are stripped too: the CSRF
// boundary is browser<->Next (already checked by `isTrustedOrigin` before
// this runs); replaying the *browser's* origin on this server-to-server
// call could make `apps/api`'s own `OriginCheckGuard` reject it against
// `CORS_ORIGIN`, which is API-owned and may legitimately differ from the
// web origin (round 2 finding).
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'cookie',
  'content-length',
  'origin',
  'referer',
])

// Forwarded/client-IP signals a browser could set on its own request to
// `apps/web`. Never relay these upstream verbatim (ADR-072): apps/api must
// only ever see a client-IP claim that `apps/web` itself derived from a
// trusted source, via `AMCORE_CLIENT_IP_HEADER` — never one the browser
// supplied. `X-Forwarded-*` is matched by prefix since the set of variants
// (`-For`, `-Host`, `-Proto`, `-Port`, ...) is open-ended; the rest are
// known lookalikes used by common proxies/CDNs (OWASP's IP-spoofing guide).
const FORWARDED_HEADER_PREFIX = 'x-forwarded-'
const CLIENT_IP_LOOKALIKE_HEADERS = new Set([
  'forwarded',
  // Bare `X-Forwarded` (no `-For`/`-Host`/`-Proto` suffix) isn't matched by
  // the prefix above but is a real, if rare, legacy header some proxies
  // still send — list it explicitly for maximum conservatism.
  'x-forwarded',
  'x-real-ip',
  'x-client-ip',
  'client-ip',
  'true-client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'x-original-forwarded-for',
  'x-original-remote-addr',
  'via',
  AMCORE_CLIENT_IP_HEADER,
])

function isSpoofableForwardingHeader(name: string): boolean {
  return name.startsWith(FORWARDED_HEADER_PREFIX) || CLIENT_IP_LOOKALIKE_HEADERS.has(name)
}

// `content-encoding`/`content-length` describe the *upstream's* compressed
// bytes, but Node's `fetch` (undici) transparently decompresses
// `Content-Encoding` when exposing `response.body` — forwarding those
// headers verbatim while streaming already-decompressed bytes would tell
// the browser to gunzip data that isn't gzipped. `transfer-encoding` is
// hop-by-hop (the `Response` constructor re-frames it itself).
// `set-cookie` is never forwarded to the browser — no proxied endpoint is
// expected to set one, but the browser must never receive a backend cookie
// directly either way (ADR-068).
const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'connection',
  'transfer-encoding',
  'set-cookie',
])

/** Request headers to send upstream: the browser's own, minus hop-by-hop/
 * cookie/forwarded-header ones, plus the vault-derived bearer token (never
 * the browser's) and — when `trustedClientIp` was resolved from a
 * configured trusted source (ADR-072) — the internal client-IP header. This
 * is the only place `AMCORE_CLIENT_IP_HEADER` is ever set on an outgoing
 * request; it runs after stripping, so a browser-supplied copy of the same
 * header name is discarded first, never merged with or overridden by it. */
export function forwardRequestHeaders(
  source: Headers,
  accessToken: string,
  trustedClientIp?: string | null
): Headers {
  const headers = new Headers()
  for (const [name, value] of source.entries()) {
    const lower = name.toLowerCase()
    if (STRIP_REQUEST_HEADERS.has(lower) || isSpoofableForwardingHeader(lower)) continue
    headers.set(name, value)
  }
  headers.set('Authorization', `Bearer ${accessToken}`)
  if (trustedClientIp) {
    headers.set(AMCORE_CLIENT_IP_HEADER, trustedClientIp)
  }
  return headers
}

/** Response headers to send back to the browser: the backend's own, minus
 * the ones that would misdescribe an already-streamed-through body. */
export function forwardResponseHeaders(source: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of source.entries()) {
    if (STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    headers.set(name, value)
  }
  return headers
}
