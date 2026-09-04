import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { GcraRedisLimiter } from './gcra-redis-limiter.service'
import { RateLimitGuard } from './rate-limit.guard'

/**
 * Rate limiting (GCRA, Option O — ADR-039/ADR-073). Owns the entire
 * mechanism — the Redis-backed limiter, `@RateLimit`/`@SkipRateLimit`, and
 * the global guard — so a downstream user never needs to touch
 * `app-imports.ts` to change rate-limit policy. Imported ahead of
 * `AuthModule` in `app-imports.ts` so `RateLimitGuard` runs before
 * `AuthenticationGuard`.
 *
 * OB-03 note: privileged admin operations override the policy per-handler
 * via `@RateLimit(...)` rather than registering a global "admin" default —
 * a global default change would apply to every route.
 */
@Module({
  providers: [GcraRedisLimiter, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [GcraRedisLimiter],
})
export class ThrottlingModule {}
