// Source-side defense for sensitive headers. Pino's path-based redact is the
// first line of defense (`req.headers.authorization` etc. in
// `logging.config.ts`), but it only fires when the log call uses the exact
// `req.headers.*` shape. Anything that copies headers under a different key,
// or any new sensitive header that wasn't added to the redact paths, slips
// through silently. This util redacts at the source so the leak surface stays
// closed regardless of how the call site is shaped.

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'stripe-signature',
  'webhook-signature',
  'x-hub-signature-256',
])

const REDACTED = '[REDACTED]'

export function sanitizeHeaders(
  headers: Record<string, unknown> | undefined | null
): Record<string, unknown> {
  if (!headers) return {}

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value
  }
  return sanitized
}
