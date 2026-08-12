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
 * cookie ones, plus the vault-derived bearer token (never the browser's). */
export function forwardRequestHeaders(source: Headers, accessToken: string): Headers {
  const headers = new Headers()
  for (const [name, value] of source.entries()) {
    if (STRIP_REQUEST_HEADERS.has(name.toLowerCase())) continue
    headers.set(name, value)
  }
  headers.set('Authorization', `Bearer ${accessToken}`)
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
