import { SkipThrottle, Throttle } from '@nestjs/throttler'

import { RateLimitPolicy, THROTTLER_NAMES } from './rate-limit-policies'

/**
 * The only supported way to override the global rate-limit backstop on a
 * route or controller. Wraps `@nestjs/throttler`'s `@Throttle` internally —
 * importing `Throttle`/`SkipThrottle` directly from `@nestjs/throttler`
 * outside this directory is banned by eslint (`no-restricted-imports`), so
 * a downstream user never needs to learn the underlying library's named-
 * throttler/per-route-per-visitor bucket model to use this safely.
 *
 * Only overrides the `long` (sustained-rate) bucket; the `short` burst
 * backstop stays the untouched global default. `policy.burst` is part of
 * the policy shape but not yet read here — see `RateLimitPolicy`.
 */
export function RateLimit(policy: RateLimitPolicy): MethodDecorator & ClassDecorator {
  return Throttle({ long: { limit: policy.rate, ttl: policy.per } })
}

/**
 * The only supported way to exempt a route or controller from the global
 * rate-limit backstop. Unlike bare `@SkipThrottle()` — which only skips a
 * throttler named `'default'`, never registered in this app, making it a
 * silent no-op — this skips every registered named throttler.
 */
export function SkipRateLimit(): MethodDecorator & ClassDecorator {
  return SkipThrottle(Object.fromEntries(THROTTLER_NAMES.map((name) => [name, true])))
}
