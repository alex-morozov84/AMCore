import { HealthIndicatorService } from '@nestjs/terminus'

import type { BoundedRedis } from '../../infrastructure/redis'

import { RedisHealthIndicator } from './redis.health'

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator
  let client: { set: jest.Mock; get: jest.Mock }
  let run: jest.Mock
  let signal: AbortSignal
  let controller: AbortController
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>
  let mockIndicator: { up: jest.Mock; down: jest.Mock }

  beforeEach(() => {
    client = { set: jest.fn(), get: jest.fn() }
    controller = new AbortController()
    signal = controller.signal
    run = jest.fn((operation: (c: typeof client, s: AbortSignal) => Promise<unknown>) =>
      operation(client, signal)
    )

    mockIndicator = {
      up: jest.fn().mockReturnValue({ redis: { status: 'up' } }),
      down: jest.fn().mockReturnValue({ redis: { status: 'down' } }),
    }

    healthIndicatorService = {
      check: jest.fn().mockReturnValue(mockIndicator),
    } as unknown as jest.Mocked<HealthIndicatorService>

    indicator = new RedisHealthIndicator({ run } as unknown as BoundedRedis, healthIndicatorService)
  })

  it('should return healthy status when Redis is accessible', async () => {
    const store = new Map<string, string>()
    client.set.mockImplementation(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    })
    client.get.mockImplementation(async (key: string) => store.get(key) ?? null)

    const result = await indicator.isHealthy('redis')

    expect(healthIndicatorService.check).toHaveBeenCalledWith('redis')
    expect(client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^__health_check__:[0-9a-f-]{36}$/),
      expect.any(String),
      { expiration: { type: 'PX', value: 1000 } }
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(mockIndicator.up).toHaveBeenCalled()
    expect(result).toEqual({ redis: { status: 'up' } })
  })

  it('should stay healthy when probes overlap on the same Redis', async () => {
    // Every write lands before any read: the worst interleaving for a shared key.
    // Distinct clock values make the old shared-key probe fail deterministically.
    jest.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(2)
    const store = new Map<string, string>()
    let writes = 0
    let allWritten: () => void = () => undefined
    const writesDone = new Promise<void>((resolve) => (allWritten = resolve))
    client.set.mockImplementation(async (key: string, value: string) => {
      store.set(key, value)
      if (++writes === 2) allWritten()
      await writesDone
      return 'OK'
    })
    client.get.mockImplementation(async (key: string) => store.get(key) ?? null)

    const results = await Promise.all([indicator.isHealthy('redis'), indicator.isHealthy('redis')])

    expect(mockIndicator.down).not.toHaveBeenCalled()
    expect(mockIndicator.up).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(new Set(client.set.mock.calls.map(([key]) => key)).size).toBe(2)
    jest.restoreAllMocks()
  })

  it('should return unhealthy status when Redis is not accessible', async () => {
    client.set.mockRejectedValue(new Error('Connection refused'))

    mockIndicator.down.mockReturnValue({
      redis: { status: 'down', message: 'Connection refused' },
    })

    const result = await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Connection refused' })
    expect(result).toEqual({ redis: { status: 'down', message: 'Connection refused' } })
  })

  it('should return unhealthy status when the bounded call fails (deadline, capacity)', async () => {
    run.mockRejectedValue(new Error('Redis operation failed: deadline'))

    await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({
      message: 'Redis operation failed: deadline',
    })
  })

  it('should not send the read once the single deadline has passed', async () => {
    client.set.mockImplementation(async () => {
      controller.abort()
      return 'OK'
    })

    await indicator.isHealthy('redis')

    expect(client.get).not.toHaveBeenCalled()
    expect(mockIndicator.down).toHaveBeenCalled()
  })

  it('should return unhealthy status when value mismatch occurs', async () => {
    client.set.mockResolvedValue('OK')
    client.get.mockResolvedValue('wrong-value')

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
    client.set.mockRejectedValue('Unknown error')

    mockIndicator.down.mockReturnValue({
      redis: { status: 'down', message: 'Redis connection failed' },
    })

    const result = await indicator.isHealthy('redis')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Redis connection failed' })
    expect(result).toEqual({ redis: { status: 'down', message: 'Redis connection failed' } })
  })
})
