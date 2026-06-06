import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createClient } from '@redis/client'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../env/env.service'
import { MetricsService } from '../observability'

export type AppRedisClient = ReturnType<typeof createClient>

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly redisClient: AppRedisClient

  constructor(
    private readonly env: EnvService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(RedisConnectionService.name)
    this.redisClient = createClient({
      url: this.env.get('REDIS_URL'),
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
      },
    })

    this.redisClient.on('error', (error) => {
      this.metrics.incRedisClientEvent('shared', 'error')
      this.logger.error({ err: error }, 'Redis client error')
    })
    this.redisClient.on('reconnecting', () => {
      this.metrics.incRedisClientEvent('shared', 'reconnecting')
    })
  }

  get client(): AppRedisClient {
    return this.redisClient
  }

  async onModuleInit(): Promise<void> {
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect()
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient.isOpen) {
      await this.redisClient.quit()
    }
  }
}
