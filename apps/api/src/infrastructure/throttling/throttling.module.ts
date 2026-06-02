import { Module } from '@nestjs/common'

import { RedisThrottlerStorage } from './redis-throttler-storage.service'

/**
 * Provides the Redis-backed throttler storage so `ThrottlerModule.forRootAsync`
 * can inject it. `REDIS_CLIENT` and `PinoLogger` come from the global Redis and
 * logger modules.
 */
@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlingModule {}
