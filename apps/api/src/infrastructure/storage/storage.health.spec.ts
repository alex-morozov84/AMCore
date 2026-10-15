import { HealthIndicatorService } from '@nestjs/terminus'
import type { PinoLogger } from 'nestjs-pino'

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
  let logger: { warn: jest.Mock; info: jest.Mock }
  let indicator: StorageHealthIndicator

  beforeEach(() => {
    storage = { exists: jest.fn() }
    up = jest.fn().mockReturnValue({ storage: { status: 'up' } })
    down = jest.fn().mockReturnValue({ storage: { status: 'down' } })
    healthIndicatorService = {
      check: jest.fn().mockReturnValue({ up, down }),
    } as unknown as jest.Mocked<HealthIndicatorService>
    env = {
      get: jest.fn((key: string) => (key === 'STORAGE_DRIVER' ? 's3' : PROBE_KEY)),
    }
    logger = { warn: jest.fn(), info: jest.fn() }
    indicator = new StorageHealthIndicator(
      storage as unknown as StorageService,
      healthIndicatorService,
      env as unknown as EnvService,
      logger as unknown as PinoLogger
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

  it('reports only a failure class when the probe throws, never the provider text', async () => {
    const secretText = 'getaddrinfo ENOTFOUND bucket.internal.example.com request id 4F2A'
    storage.exists.mockRejectedValue(new Error(secretText))

    const result = await indicator.isHealthy('storage')

    expect(result).toEqual({ storage: { status: 'down' } })
    expect(down).toHaveBeenCalledWith({ failure: 'io_error' })
    expect(JSON.stringify(down.mock.calls)).not.toContain('internal.example.com')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'storage_health_failed', driver: 's3', failure: 'io_error' })
    )
  })

  it('logs once per failure class and once on recovery, however often readiness is polled', async () => {
    storage.exists.mockRejectedValue(new Error('boom'))
    await indicator.isHealthy('storage')
    await indicator.isHealthy('storage')
    await indicator.isHealthy('storage')
    expect(logger.warn).toHaveBeenCalledTimes(1)

    storage.exists.mockRejectedValue(Object.assign(new Error('x'), { name: 'AccessDenied' }))
    await indicator.isHealthy('storage')
    await indicator.isHealthy('storage')
    expect(logger.warn).toHaveBeenCalledTimes(2)

    storage.exists.mockResolvedValue(true)
    await indicator.isHealthy('storage')
    await indicator.isHealthy('storage')
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'storage_health_recovered' })
    )
  })

  it.each([
    [{ name: 'AccessDenied', message: 'Access Denied for bucket x' }],
    [{ $metadata: { httpStatusCode: 403 }, message: 'Forbidden' }],
    [{ code: 'EACCES', message: "EACCES: permission denied, open '/app/uploads/x'" }],
  ])('classifies an access failure as access_denied without its message (%#)', async (error) => {
    storage.exists.mockRejectedValue(Object.assign(new Error(error.message), error))

    await indicator.isHealthy('storage')

    expect(down).toHaveBeenCalledWith({ failure: 'access_denied' })
  })
})
