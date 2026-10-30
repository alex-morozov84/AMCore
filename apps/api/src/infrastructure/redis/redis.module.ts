import { Global, Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module.js'

import { AbuseCounterStore } from './abuse-counter.store.js'
import { AuthCacheLock } from './auth-redis/auth-cache-lock.js'
import { AuthRedis } from './auth-redis/auth-redis.service.js'
import { BoundedRedis } from './bounded-redis.js'
import { REDIS_CLIENT } from './redis.constants.js'
import { RedisConnectionService } from './redis-connection.service.js'
import { RedisLockService } from './redis-lock.service.js'
import { RedisMutexService } from './redis-mutex.service.js'
import { RedisPingMetricsCollector } from './redis-ping-metrics.collector.js'

@Global()
@Module({
  imports: [EnvModule],
  providers: [
    RedisConnectionService,
    RedisLockService,
    RedisMutexService,
    RedisPingMetricsCollector,
    BoundedRedis,
    AuthRedis,
    AuthCacheLock,
    AbuseCounterStore,
    {
      provide: REDIS_CLIENT,
      inject: [RedisConnectionService],
      useFactory: (connection: RedisConnectionService) => connection.client,
    },
  ],
  exports: [
    REDIS_CLIENT,
    RedisConnectionService,
    RedisLockService,
    RedisMutexService,
    BoundedRedis,
    AuthRedis,
    AuthCacheLock,
    AbuseCounterStore,
  ],
})
export class RedisModule {}
