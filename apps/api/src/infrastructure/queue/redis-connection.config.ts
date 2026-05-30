import type { RedisOptions } from 'bullmq'
import { URL } from 'url'

/**
 * Build the BullMQ Redis connection options from `REDIS_URL` (EQS-06).
 *
 * The previous inline parsing dropped the URL scheme, the ACL username, and any
 * resilience policy. This builder is the single, testable source of those:
 *
 * - **TLS** is enabled iff the scheme is `rediss://` (managed / in-transit-
 *   encrypted Redis: Upstash, ElastiCache, Redis Cloud). Plain `redis://` is
 *   left untouched — no `tls` key, so local/dev behavior is unchanged.
 * - **username / password / db** are all parsed (Redis 6 ACL support).
 * - **retryStrategy** mirrors `RedisConnectionService` (the main app client) so
 *   both Redis clients reconnect on one consistent curve.
 *
 * Deliberately does NOT set `maxRetriesPerRequest`: on the producer connection
 * `null` would make `queue.add()` hang forever during an outage, and BullMQ
 * already enforces `null` on the worker's blocking connection itself. Caller
 * outage semantics are handled at the call site (OD-5), not by crippling the
 * connection.
 */
export function buildBullConnection(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl)

  const options: RedisOptions = {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    db: url.pathname ? parseInt(url.pathname.slice(1), 10) || 0 : 0,
    // Mirror RedisConnectionService: backoff 50ms per attempt, capped at 2s.
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  }

  // URL getters keep credentials percent-encoded; decode so special characters
  // survive (the whole reason to put them in the URL).
  if (url.username) options.username = decodeURIComponent(url.username)
  if (url.password) options.password = decodeURIComponent(url.password)

  // TLS only for rediss://. `servername` drives SNI for managed providers.
  if (url.protocol === 'rediss:') options.tls = { servername: url.hostname }

  return options
}
