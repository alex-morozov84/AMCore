import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../env/env.service.js'
import { MetricsService } from '../observability/index.js'

import { type AppRedisClient, createAppRedisClient } from './redis-client-options.js'

export type { AppRedisClient }

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly redisClient: AppRedisClient

  constructor(
    private readonly env: EnvService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext(RedisConnectionService.name)
    this.redisClient = createAppRedisClient(this.env.get('REDIS_URL'))

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
