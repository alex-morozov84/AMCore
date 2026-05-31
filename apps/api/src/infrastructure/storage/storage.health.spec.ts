import { HealthIndicatorService } from '@nestjs/terminus'

import { StorageHealthIndicator } from './storage.health'
import type { StorageService } from './storage.service'

import type { EnvService } from '@/env/env.service'

const PROBE_KEY = 'avatars/.health'

describe('StorageHealthIndicator', () => {
  let storage: { exists: jest.Mock }
  let up: jest.Mock
  let down: jest.Mock
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>
  let env: { get: jest.Mock }
  let indicator: StorageHealthIndicator

  beforeEach(() => {
    storage = { exists: jest.fn() }
    up = jest.fn().mockReturnValue({ storage: { status: 'up' } })
    down = jest.fn().mockReturnValue({ storage: { status: 'down' } })
    healthIndicatorService = {
      check: jest.fn().mockReturnValue({ up, down }),
    } as unknown as jest.Mocked<HealthIndicatorService>
    env = { get: jest.fn().mockReturnValue(PROBE_KEY) }
    indicator = new StorageHealthIndicator(
      storage as unknown as StorageService,
      healthIndicatorService,
      env as unknown as EnvService
    )
  })

  it('reports up when the probe succeeds, using the configured probe key', async () => {
    storage.exists.mockResolvedValue(false)

    const result = await indicator.isHealthy('storage')

    expect(result).toEqual({ storage: { status: 'up' } })
    expect(storage.exists).toHaveBeenCalledWith(PROBE_KEY)
    expect(env.get).toHaveBeenCalledWith('STORAGE_HEALTH_PROBE_KEY')
    expect(up).toHaveBeenCalled()
    expect(down).not.toHaveBeenCalled()
  })

  it('reports down with the error message when the probe throws', async () => {
    storage.exists.mockRejectedValue(new Error('endpoint unreachable'))

    const result = await indicator.isHealthy('storage')

    expect(result).toEqual({ storage: { status: 'down' } })
    expect(down).toHaveBeenCalledWith({ message: 'endpoint unreachable' })
  })
})
