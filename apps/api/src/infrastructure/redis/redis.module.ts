import { Global, Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module'

import { REDIS_CLIENT } from './redis.constants'
import { RedisConnectionService } from './redis-connection.service'
import { RedisLockService } from './redis-lock.service'

@Global()
@Module({
  imports: [EnvModule],
  providers: [
    RedisConnectionService,
    RedisLockService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisConnectionService],
      useFactory: (connection: RedisConnectionService) => connection.client,
    },
  ],
  exports: [REDIS_CLIENT, RedisConnectionService, RedisLockService],
})
export class RedisModule {}
