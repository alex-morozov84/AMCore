import { Global, Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module'

import { REDIS_CLIENT } from './redis.constants'
import { RedisConnectionService } from './redis-connection.service'
import { RedisLockService } from './redis-lock.service'
import { RedisMutexService } from './redis-mutex.service'
import { RedisPingMetricsCollector } from './redis-ping-metrics.collector'

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
