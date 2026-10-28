import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

import { BoundedRedis } from '../../infrastructure/redis/index.js'

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: BoundedRedis,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)

    try {
      // Test Redis connectivity by setting and getting a test value. Each probe owns its
      // key: probes overlap across endpoints and across replicas sharing one Redis, and a
      // shared key would let one probe read another's value and report a false mismatch.
      // One deadline covers both commands: the read is not sent once it has passed.
      const testValue = randomUUID()
      const testKey = `__health_check__:${testValue}`

      const result = await this.redis.run(async (client, signal) => {
        await client.set(testKey, testValue, { expiration: { type: 'PX', value: 1000 } })
        signal.throwIfAborted()
        return client.get(testKey)
      })

      if (result === testValue) {
        return indicator.up()
      }

      return indicator.down({ message: 'Redis health check failed: value mismatch' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redis connection failed'
      return indicator.down({ message })
    }
  }
}
