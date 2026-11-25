import type { WebRedisClient } from '@/shared/api/bff/redis-client'

import 'server-only'

const WINDOW_SECONDS = 10
const MAX_REPORTS_PER_WINDOW = 20
const REDIS_KEY_PREFIX = 'csp-report-rate-limit:'

/**
 * A best-effort fixed window limits CSP report volume per client identity.
 *
 * `key` should be the caller's resolved client identity (see
 * `resolveTrustedClientIp` — falls back to a single shared bucket when no
 * trusted header is configured, a known, documented limitation rather than
 * pretending per-IP granularity exists without it).
 *
 * Fails **open** on a Redis error: unlike the BFF session vault
 * (ADR-068, fail-closed — an auth decision), a rate-limiter outage here
 * should not block reports or 500 the endpoint. The caller still gets the
 * body-size cap and content-type allowlist as a backstop.
 */
export async function isCspReportRateLimited(redis: WebRedisClient, key: string): Promise<boolean> {
  try {
    const redisKey = `${REDIS_KEY_PREFIX}${key}`
    const count = await redis.incr(redisKey)
    if (count === 1) {
      await redis.expire(redisKey, WINDOW_SECONDS)
    }
    return count > MAX_REPORTS_PER_WINDOW
  } catch (error) {
    console.error('[csp-report] rate-limit check failed, allowing the report through', error)
    return false
  }
}
