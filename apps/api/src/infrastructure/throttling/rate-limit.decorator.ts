import { type CustomDecorator, SetMetadata } from '@nestjs/common'

import type { RateLimitPolicy } from './rate-limit-policies'

/** Metadata key for a route/controller's rate-limit policy override. */
export const RATE_LIMIT_POLICY_KEY = 'amcore:rateLimit:policy'

/** Metadata key marking a route/controller exempt from the global rate limit. */
export const RATE_LIMIT_SKIP_KEY = 'amcore:rateLimit:skip'

/**
 * Override the global rate-limit backstop (`RATE_LIMIT_POLICIES.DEFAULT`)
 * on a route or controller with an explicit policy, either a named policy
 * from `RATE_LIMIT_POLICIES` or an inline `{ rate, per, burst? }` — see the
 * Telegram webhook controller for an inline example. Applies to every route
 * with zero decorator required; only add this when a route needs something
 * *different* from the default.
 */
export function RateLimit(policy: RateLimitPolicy): CustomDecorator<string> {
  return SetMetadata(RATE_LIMIT_POLICY_KEY, policy)
}

/**
 * The only supported way to exempt a route or controller from the global
 * rate-limit backstop (health/metrics probes only, normally).
 */
export function SkipRateLimit(): CustomDecorator<string> {
  return SetMetadata(RATE_LIMIT_SKIP_KEY, true)
}
