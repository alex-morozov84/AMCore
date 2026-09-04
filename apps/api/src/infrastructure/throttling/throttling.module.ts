import { forwardRef, Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'

import { DEFAULT_THROTTLERS } from './rate-limit-policies'
import { RedisThrottlerStorage } from './redis-throttler-storage.service'

/**
 * Rate limiting (Redis-backed global throttler — ADR-039).
 *
 * Owns the entire `@nestjs/throttler` registration — named throttlers,
 * default numbers, `RedisThrottlerStorage`, `@RateLimit`/`@SkipRateLimit`,
 * and the guard live in this one directory, so a downstream user never
 * needs to touch `app-imports.ts` to change rate-limit policy. Storage is
 * Redis-backed so the short/long limits are shared across API replicas
 * instead of being process-local.
 *
 * OB-03 note: privileged admin operations override the `long` bucket
 * per-handler via `@RateLimit(...)` rather than registering a third global
 * named throttler — a third named throttler here would apply its default
 * limit to every route.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      // Self-import: this dynamic module's own useFactory needs
      // RedisThrottlerStorage, which is provided by the ThrottlingModule
      // instance composing it. forwardRef breaks the definition-order cycle.
      imports: [forwardRef(() => ThrottlingModule)],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [...DEFAULT_THROTTLERS],
        storage,
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage, ThrottlerModule],
})
export class ThrottlingModule {}
