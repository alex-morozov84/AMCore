import { HealthIndicatorService } from '@nestjs/terminus'
import type { Cache } from 'cache-manager'

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
    const store = new Map<string, unknown>()
    cacheManager.set.mockImplementation(async (key: string, value: unknown) => {
      store.set(key, value)
      return value
    })
    cacheManager.get.mockImplementation(async (key: string) => store.get(key))

    const result = await indicator.isHealthy('redis')

    expect(healthIndicatorService.check).toHaveBeenCalledWith('redis')
    expect(cacheManager.set).toHaveBeenCalledWith(
      expect.stringMatching(/^__health_check__:[0-9a-f-]{36}$/),
      expect.any(String),
      1000
    )
    expect(mockIndicator.up).toHaveBeenCalled()
    expect(result).toEqual({ redis: { status: 'up' } })
  })

  it('should stay healthy when probes overlap on the same Redis', async () => {
    // Every write lands before any read: the worst interleaving for a shared key.
    // Distinct clock values make the old shared-key probe fail deterministically.
    jest.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(2)
    const store = new Map<string, unknown>()
    let writes = 0
    let allWritten: () => void = () => undefined
    const writesDone = new Promise<void>((resolve) => (allWritten = resolve))
    cacheManager.set.mockImplementation(async (key: string, value: unknown) => {
      store.set(key, value)
      if (++writes === 2) allWritten()
      await writesDone
      return value
    })
    cacheManager.get.mockImplementation(async (key: string) => store.get(key))

    const results = await Promise.all([indicator.isHealthy('redis'), indicator.isHealthy('redis')])

    expect(mockIndicator.down).not.toHaveBeenCalled()
    expect(mockIndicator.up).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(new Set(cacheManager.set.mock.calls.map(([key]) => key)).size).toBe(2)
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
