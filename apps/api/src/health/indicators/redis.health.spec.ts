import { HealthIndicatorService } from '@nestjs/terminus'
import { Cache } from 'cache-manager'

import { RedisHealthIndicator } from './redis.health'

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator
  let cacheManager: jest.Mocked<Cache>
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>
  let mockIndicator: { up: jest.Mock; down: jest.Mock }

  beforeEach(() => {
    cacheManager = {
      set: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<Cache>

    mockIndicator = {
      up: jest.fn().mockReturnValue({ redis: { status: 'up' } }),
      down: jest.fn().mockReturnValue({ redis: { status: 'down' } }),
    }

    healthIndicatorService = {
      check: jest.fn().mockReturnValue(mockIndicator),
    } as unknown as jest.Mocked<HealthIndicatorService>

    indicator = new RedisHealthIndicator(cacheManager, healthIndicatorService)
  })

  it('should return healthy status when Redis is accessible', async () => {
    cacheManager.set.mockResolvedValue(undefined)
    cacheManager.get.mockImplementation(async (key: string) => {
      if (key === '__health_check__') {
        return Promise.resolve(Date.now().toString())
      }
      return Promise.resolve(undefined)
    })

    // Mock get to return the same value that was set
    jest.spyOn(Date, 'now').mockReturnValue(1234567890)
    cacheManager.get.mockResolvedValue('1234567890')

    const result = await indicator.isHealthy('redis')

    expect(healthIndicatorService.check).toHaveBeenCalledWith('redis')
    expect(cacheManager.set).toHaveBeenCalledWith('__health_check__', '1234567890', 1000)
    expect(mockIndicator.up).toHaveBeenCalled()
    expect(result).toEqual({ redis: { status: 'up' } })

    jest.restoreAllMocks()
  })

  it('should return unhealthy status when Redis is not accessible', async () => {
    const error = new Error('Connection refused')
    cacheManager.set.mockRejectedValue(error)

    mockIndicator.down.mockReturnValue({
      redis: { status: 'down', message: 'Connection refused' },
    })

    const result = await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Connection refused' })
    expect(result).toEqual({ redis: { status: 'down', message: 'Connection refused' } })
  })

  it('should return unhealthy status when value mismatch occurs', async () => {
    cacheManager.set.mockResolvedValue(undefined)
    cacheManager.get.mockResolvedValue('wrong-value')

    mockIndicator.down.mockReturnValue({
      redis: { status: 'down', message: 'Redis health check failed: value mismatch' },
    })

    const result = await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({
      message: 'Redis health check failed: value mismatch',
    })
    expect(result).toEqual({
      redis: { status: 'down', message: 'Redis health check failed: value mismatch' },
    })
  })

  it('should handle non-Error exceptions', async () => {
    cacheManager.set.mockRejectedValue('Unknown error')

    mockIndicator.down.mockReturnValue({
      redis: { status: 'down', message: 'Redis connection failed' },
    })

    const result = await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Redis connection failed' })
    expect(result).toEqual({ redis: { status: 'down', message: 'Redis connection failed' } })
  })
})
