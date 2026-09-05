import { getWebRedisClient } from '@/shared/api/bff/redis-client'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isCspReportRateLimited } from './csp-report-rate-limit'
import { parseCspReport } from './parse-csp-report'
import { readBodyWithLimit } from './read-body-with-limit'

import 'server-only'

const MAX_BODY_BYTES = 16 * 1024
const ACCEPTED_CONTENT_TYPES = new Set(['application/csp-report', 'application/reports+json'])
const REDIS_ACQUIRE_TIMEOUT_MS = 250

/**
 * `getWebRedisClient()`'s underlying `connect()` never rejects when Redis
 * is unreachable — its `reconnectStrategy` (ADR-068's session vault,
 * correctly, wants indefinite retry-with-backoff there) just keeps trying
 * forever. Awaiting it directly here would hang this request indefinitely
 * whenever Redis is down, defeating the entire fail-open design. Racing it
 * against a short timeout instead — found by actually testing this against
 * an unreachable Redis, not assumed.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    }),
  ])
}

// Used as the rate-limit bucket key when no trusted client-IP header is
// configured (WEB_TRUSTED_CLIENT_IP_HEADER, ADR-072) — a documented
// limitation, not a silent one: without it, this endpoint can only cap
// *total* report volume, not per-client volume. See docs/frontend/ (Track 3
// PR4's documentation checkpoint).
const UNATTRIBUTED_CLIENT_KEY = 'unattributed'

/**
 * Minimal CSP violation reporting endpoint (Track 3 PR3,
 * `ai/models-talk.md` FINAL PLAN §3 / owner decision §0.4): observability
 * only, not a protection mechanism. Deliberately does not persist reports
 * anywhere — logs a normalized, redacted summary via `console.warn` (the
 * same plain-`console` convention the rest of `shared/api/bff` uses) for
 * whatever log aggregation the deployment already has, and nothing else.
 * Production teams that want more should route this to their own
 * observability stack or an external CSP reporting provider instead of
 * this starter growing one in-house.
 *
 * Always responds `204` — a public, unauthenticated endpoint has no useful
 * distinction to report back to the browser, which ignores the response
 * body/most status codes for reporting endpoints regardless.
 */
export async function handleCspReport(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim()
  if (!contentType || !ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return new Response(null, { status: 204 })
  }

  const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    return new Response(null, { status: 204 })
  }

  const clientKey = resolveTrustedClientIp(request.headers) ?? UNATTRIBUTED_CLIENT_KEY
  try {
    const redis = await withTimeout(getWebRedisClient(), REDIS_ACQUIRE_TIMEOUT_MS)
    if (await isCspReportRateLimited(redis, clientKey)) {
      return new Response(null, { status: 204 })
    }
  } catch (error) {
    // Redis itself unreachable or slow to (re)connect (not just the
    // rate-limit check failing internally, which isCspReportRateLimited
    // already fails open on) — still accept the report rather than hang or
    // 500 a public endpoint over an outage in an unrelated dependency.
    console.error('[csp-report] Redis unavailable, skipping rate limit', error)
  }

  const reports = parseCspReport(contentType, rawBody)
  if (reports) {
    for (const report of reports) {
      console.warn('[csp-report]', report)
    }
  }

  return new Response(null, { status: 204 })
}
