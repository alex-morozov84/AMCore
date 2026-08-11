import 'server-only'

const TRUSTED_ORIGINS = (process.env.WEB_TRUSTED_ORIGINS ?? 'http://localhost:3002')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

type OriginCheckResult = 'absent' | 'malformed' | { origin: string }

function parseOrigin(value: string): OriginCheckResult {
  try {
    return { origin: new URL(value).origin }
  } catch {
    return 'malformed'
  }
}

function resolveOrigin(request: Request): OriginCheckResult {
  const originHeader = request.headers.get('origin')
  if (originHeader) return parseOrigin(originHeader)

  const refererHeader = request.headers.get('referer')
  if (!refererHeader) return 'absent'
  return parseOrigin(refererHeader)
}

/**
 * Mirrors `apps/api`'s `OriginCheckGuard` (ADR-047) at the new browser↔Next
 * boundary (ADR-068): exact-origin `Origin` check, then origin-reduced
 * `Referer` fallback, allow when both are absent — a header-less request
 * isn't a browser request (SSR/native/CLI can't mount CSRF in the first
 * place). Config is deliberately **web-owned** (`WEB_TRUSTED_ORIGINS`), not
 * borrowed from `apps/api`'s `CORS_ORIGIN`, which serves a different purpose
 * (round 2 review correction — see ai/models-talk.md).
 */
export function isTrustedOrigin(request: Request): boolean {
  const result = resolveOrigin(request)
  if (result === 'absent') return true
  if (result === 'malformed') return false
  return TRUSTED_ORIGINS.includes(result.origin)
}
