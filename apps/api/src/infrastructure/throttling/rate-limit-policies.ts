/**
 * Names of every throttler registered with `ThrottlerModule` (see
 * `throttling.module.ts`). Single source of truth for both the runtime
 * registration and `rate-limit-decorator-coverage.spec.ts`'s metadata
 * introspection, so the two cannot drift.
 */
export const THROTTLER_NAMES = ['short', 'long'] as const

export type ThrottlerName = (typeof THROTTLER_NAMES)[number]

interface ThrottlerDefault {
  name: ThrottlerName
  /** Window size in milliseconds. */
  ttl: number
  limit: number
}

/**
 * Global backstop every route gets for free with zero code required —
 * `short` catches request floods within a second, `long` catches sustained
 * abuse over a minute. `@RateLimit(...)` overrides only the `long` bucket
 * per-route; `short` stays the untouched global backstop.
 */
export const DEFAULT_THROTTLERS: readonly ThrottlerDefault[] = [
  { name: 'short', ttl: 1000, limit: 10 }, // 10 requests per second
  { name: 'long', ttl: 60_000, limit: 100 }, // 100 requests per minute
]

/**
 * `@RateLimit(...)`'s policy shape. Deliberately `rate`/`per`-shaped rather
 * than `@nestjs/throttler`'s `{ short?, long? }` — a downstream user of this
 * decorator should never need to know which underlying library or algorithm
 * enforces it.
 *
 * Intentionally has no `burst` field yet: a burst-tolerant limiter is a
 * planned follow-up, but until it's live, accepting `burst` here would be a
 * parameter that looks like it works and silently does nothing — exactly
 * the class of bug this decorator exists to eliminate. It will be added
 * once it has a real effect, additively (existing call sites are
 * unaffected, since it will be optional).
 */
export interface RateLimitPolicy {
  /** Max requests allowed within `per` milliseconds. */
  rate: number
  /** Window size in milliseconds. */
  per: number
}

export const RATE_LIMIT_POLICIES = {
  /** Privileged mutations an authenticated actor rarely repeats quickly. */
  PRIVILEGED_MUTATION: { rate: 20, per: 60_000 },
  /** Expensive, resource-intensive actions (e.g. bulk/admin operations). */
  EXPENSIVE_ACTION: { rate: 5, per: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>
