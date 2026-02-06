import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Inject, Injectable } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import { Cache } from 'cache-manager'

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)

    try {
      // Test Redis connectivity by setting and getting a test value
      const testKey = '__health_check__'
      const testValue = Date.now().toString()

      await this.cacheManager.set(testKey, testValue, 1000) // 1 second TTL
      const result = await this.cacheManager.get<string>(testKey)

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
