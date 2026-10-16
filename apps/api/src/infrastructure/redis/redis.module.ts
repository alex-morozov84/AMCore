import { Global, Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module.js'

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
    {
      provide: REDIS_CLIENT,
      inject: [RedisConnectionService],
      useFactory: (connection: RedisConnectionService) => connection.client,
    },
  ],
  exports: [REDIS_CLIENT, RedisConnectionService, RedisLockService, RedisMutexService],
})
export class RedisModule {}
