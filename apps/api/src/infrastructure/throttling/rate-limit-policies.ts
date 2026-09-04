/**
 * `@RateLimit(...)`'s policy shape. `rate`/`per`-shaped rather than any
 * particular library's named-throttler concept — a downstream user of this
 * decorator never needs to know the storage/algorithm behind it.
 *
 * `burst` is the number of requests admitted instantly from idle, above the
 * sustained `rate`. Omitted, it defaults to `rate` (no extra burst
 * headroom beyond the sustained rate itself) — see `resolveBurst`.
 */
export interface RateLimitPolicy {
  /** Sustained requests allowed per `per` milliseconds, once idle headroom is spent. */
  rate: number
  /** Window size in milliseconds. */
  per: number
  /** Instantaneous burst capacity above the sustained `rate`. Defaults to `rate`. */
  burst?: number
}

/** `policy.burst ?? policy.rate` — the actual admission capacity from idle. */
export function resolveBurst(policy: RateLimitPolicy): number {
  return policy.burst ?? policy.rate
}

export const RATE_LIMIT_POLICIES = {
  /** Global backstop every route gets for free with zero code required. */
  DEFAULT: { rate: 100, per: 60_000, burst: 50 },
  /** Privileged mutations an authenticated actor rarely repeats quickly. */
  PRIVILEGED_MUTATION: { rate: 20, per: 60_000, burst: 20 },
  /** Expensive, resource-intensive actions (e.g. bulk/admin operations). */
  EXPENSIVE_ACTION: { rate: 5, per: 60_000, burst: 5 },
} as const satisfies Record<string, RateLimitPolicy>

/**
 * Bounded classification of a resolved policy for metrics only (never a
 * route/tracker/free-text label — cardinality must stay fixed). Matches by
 * object identity against the named policies above, since
 * `Reflector.getAllAndOverride` returns the exact object a decorator was
 * given; any other policy (an inline literal, e.g. the Telegram webhook's)
 * classifies as `'custom'`. Return type intentionally matches (but doesn't
 * import) `RateLimitMetricsPolicy` in `infrastructure/observability` —
 * `throttling` depends on `observability`'s `MetricsService`, so the metric
 * label type is owned there, not here.
 */
export function classifyPolicy(
  policy: RateLimitPolicy
): 'default' | 'privileged_mutation' | 'expensive_action' | 'custom' {
  if (policy === RATE_LIMIT_POLICIES.DEFAULT) return 'default'
  if (policy === RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION) return 'privileged_mutation'
  if (policy === RATE_LIMIT_POLICIES.EXPENSIVE_ACTION) return 'expensive_action'
  return 'custom'
}
