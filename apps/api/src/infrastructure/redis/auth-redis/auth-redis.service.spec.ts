import { ClientClosedError } from '@redis/client'
import type { PinoLogger } from 'nestjs-pino'

import { ServiceUnavailableException } from '../../../common/exceptions/index.js'
import type { EnvService } from '../../../env/env.service.js'
import type { MetricsService } from '../../observability/index.js'
import type { AppRedisClient } from '../redis-client-options.js'

import { AuthRedis } from './auth-redis.service.js'
import { FakeRedisClient } from './fake-redis-client.testkit.js'

class TestAuthRedis extends AuthRedis {
  readonly clients: FakeRedisClient[] = []
  autoReady = true

  protected override newClient(): AppRedisClient {
    const client = new FakeRedisClient()
    client.autoReady = this.autoReady
    this.clients.push(client)
    return client.asClient()
  }
}

describe('AuthRedis', () => {
  let metrics: { incRedisClientEvent: jest.Mock }
  let logger: { setContext: jest.Mock; warn: jest.Mock; error: jest.Mock }
  let service: TestAuthRedis

  const make = (autoReady = true): TestAuthRedis => {
    const instance = new TestAuthRedis(
      { get: () => 'redis://localhost:6379' } as unknown as EnvService,
      logger as unknown as PinoLogger,
      metrics as unknown as MetricsService
    )
    instance.autoReady = autoReady
    return instance
  }

  beforeEach(() => {
    jest.useFakeTimers()
    metrics = { incRedisClientEvent: jest.fn() }
    logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = make()
  })
  afterEach(() => {
    service.onApplicationShutdown()
    jest.useRealTimers()
  })

  it('becomes ready during module init and serves operations through the supervisor', async () => {
    const init = service.onModuleInit()
    await jest.advanceTimersByTimeAsync(100)
    await init
    expect(service.ready).toBe(true)
    await expect(service.run((client) => client.ping())).resolves.toBe('PONG')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does not block startup forever when Redis is down: warns and answers fast 503s', async () => {
    service = make(false)
    const init = service.onModuleInit()
    await jest.advanceTimersByTimeAsync(2000)
    await init
    expect(service.ready).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not ready at startup'))
    await expect(service.run((client) => client.ping())).rejects.toMatchObject({
      reason: 'not_ready',
      outcome: 'not_sent',
    })
  })

  it('reports client errors and replacements as auth client events', async () => {
    const init = service.onModuleInit()
    await jest.advanceTimersByTimeAsync(100)
    await init
    const [client] = service.clients
    client!.emit('error', new Error('boom'))
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('auth', 'error')
    client!.loseReadiness()
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('auth', 'reconnecting')
    await jest.advanceTimersByTimeAsync(4000)
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('auth', 'degraded')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'reconnect-hang' }),
      'Auth Redis client generation replaced'
    )
  })

  describe('call', () => {
    beforeEach(async () => {
      const init = service.onModuleInit()
      await jest.advanceTimersByTimeAsync(100)
      await init
    })

    it('returns the result of a healthy operation', async () => {
      await expect(service.call((client) => client.ping())).resolves.toBe('PONG')
    })

    it('maps an outage-class failure to the typed 503 and logs the cause', async () => {
      const error = await service
        .call(async () => {
          throw new ClientClosedError()
        })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(error).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ reason: 'command', cause: expect.any(ClientClosedError) }),
        }),
        'Auth Redis operation unavailable'
      )
    })

    it('maps a missed deadline to 503 without claiming the command did not run', async () => {
      service.clients[0]!.hold = true
      const outcome = service.call((client) => client.ping(), 250).catch((e: unknown) => e)
      await jest.advanceTimersByTimeAsync(300)
      await expect(outcome).resolves.toBeInstanceOf(ServiceUnavailableException)
    })

    it('keeps programming errors visible instead of calling them an outage', async () => {
      const bug = new TypeError('client.nope is not a function')
      await expect(
        service.call(async () => {
          throw bug
        })
      ).rejects.toMatchObject({ reason: 'command', cause: bug })
    })

    it('refuses fast with 503 while no generation is ready', async () => {
      service.clients[0]!.loseReadiness(false)
      await expect(service.call((client) => client.ping())).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )
    })
  })

  it('disposes the client on shutdown and stops creating generations', async () => {
    const init = service.onModuleInit()
    await jest.advanceTimersByTimeAsync(100)
    await init
    service.onApplicationShutdown()
    expect(service.clients[0]!.destroyed).toBe(true)
    await jest.advanceTimersByTimeAsync(10000)
    expect(service.clients).toHaveLength(1)
    expect(service.ready).toBe(false)
  })
})
