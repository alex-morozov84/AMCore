import { createClient } from '@redis/client'
import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../env/env.service'
import type { MetricsService } from '../observability'

import { RedisConnectionService } from './redis-connection.service'

jest.mock('@redis/client', () => ({
  createClient: jest.fn(),
}))

describe('RedisConnectionService metrics', () => {
  it('counts verified shared-client error and reconnecting events', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const client: { on: jest.Mock } = {
      on: jest.fn((event: string, listener: (...args: unknown[]) => void): unknown => {
        listeners.set(event, listener)
        return client
      }),
    }
    jest.mocked(createClient).mockReturnValue(client as never)
    const env = {
      get: jest.fn().mockReturnValue('redis://localhost:6379'),
    } as unknown as EnvService
    const logger = {
      setContext: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger
    const metrics = {
      incRedisClientEvent: jest.fn(),
    } as unknown as MetricsService

    new RedisConnectionService(env, logger, metrics)
    listeners.get('error')?.(new Error('redis down'))
    listeners.get('reconnecting')?.()

    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('shared', 'error')
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('shared', 'reconnecting')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
