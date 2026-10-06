import type { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../env/env.service'
import { MetricsService } from '../infrastructure/observability'

import {
  handleSlowQuery,
  logSlowQuery,
  PrismaService,
  resolveSlowQueryThresholdMs,
  SHUTDOWN_BARRIER_MAX_MS,
} from './prisma.service'

describe('PrismaService slow query logging', () => {
  let logger: Pick<jest.Mocked<PinoLogger>, 'warn'>

  beforeEach(() => {
    logger = {
      warn: jest.fn(),
    }
  })

  it('uses a 100ms default threshold outside production', () => {
    expect(resolveSlowQueryThresholdMs('development', 100)).toBe(100)
    expect(resolveSlowQueryThresholdMs('test', 100)).toBe(100)
  })

  it('uses a 500ms default threshold in production', () => {
    expect(resolveSlowQueryThresholdMs('production', 500)).toBe(500)
  })

  it('logs only query template and duration when the threshold is exceeded', () => {
    logSlowQuery(
      {
        query: 'SELECT * FROM "User" WHERE "email" = $1',
        duration: 125,
        params: '["user@example.com"]',
      },
      100,
      logger
    )

    expect(logger.warn).toHaveBeenCalledWith(
      {
        query: 'SELECT * FROM "User" WHERE "email" = $1',
        duration: 125,
      },
      'slow query'
    )
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.anything(),
      }),
      expect.anything()
    )
  })

  it('does not log when the query duration is at or below the threshold', () => {
    logSlowQuery(
      {
        query: 'SELECT 1',
        duration: 100,
        params: '[]',
      },
      100,
      logger
    )

    logSlowQuery(
      {
        query: 'SELECT 1',
        duration: 50,
        params: '[]',
      },
      100,
      logger
    )

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('increments the metric only when the slow-query threshold is exceeded', () => {
    const metrics = { incDbSlowQuery: jest.fn() }

    handleSlowQuery({ query: 'SELECT 1', duration: 100 }, 100, logger, metrics)
    handleSlowQuery({ query: 'SELECT 1', duration: 101 }, 100, logger, metrics)

    expect(metrics.incDbSlowQuery).toHaveBeenCalledTimes(1)
  })
})

describe('PrismaService constructor', () => {
  // Regression: subscribing to Prisma 'query' events must keep `this` bound to
  // the client instance. A detached reference (`const f = this.$on; f(...)`)
  // throws "Cannot read properties of undefined (reading '_engineConfig')".
  it('constructs without losing $on `this` binding', () => {
    const envValues: Record<string, unknown> = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      DATABASE_POOL_MAX: 10,
      DATABASE_POOL_IDLE_MS: 30_000,
      DATABASE_CONNECT_MS: 5_000,
      DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
      DATABASE_QUERY_TIMEOUT_MS: 30_000,
      NODE_ENV: 'test',
      SLOW_QUERY_THRESHOLD_MS: 100,
      PROCESS_ROLE: 'web',
    }
    const env = { get: (key: string) => envValues[key] } as unknown as EnvService
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
    } as unknown as PinoLogger
    const metrics = {
      incDbSlowQuery: jest.fn(),
    } as unknown as MetricsService

    expect(() => new PrismaService(env, logger, metrics)).not.toThrow()
  })
})

describe('PrismaService shutdown barriers and teardown', () => {
  const envValues: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_IDLE_MS: 30_000,
    DATABASE_CONNECT_MS: 5_000,
    DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    DATABASE_QUERY_TIMEOUT_MS: 30_000,
    NODE_ENV: 'test',
    SLOW_QUERY_THRESHOLD_MS: 100,
    PROCESS_ROLE: 'worker',
  }
  let logger: { setContext: jest.Mock; warn: jest.Mock; error: jest.Mock }
  let service: PrismaService
  let calls: string[]

  beforeEach(() => {
    calls = []
    logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = new PrismaService(
      { get: (key: string) => envValues[key] } as unknown as EnvService,
      logger as unknown as PinoLogger,
      { incDbSlowQuery: jest.fn() } as unknown as MetricsService
    )
    jest.spyOn(service, '$disconnect').mockImplementation(async () => {
      calls.push('disconnect')
    })
    jest
      .spyOn((service as unknown as { pool: { end: () => Promise<void> } }).pool, 'end')
      .mockImplementation(async () => {
        calls.push('pool.end')
      })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('runs every registered barrier BEFORE disconnecting the database', async () => {
    service.registerShutdownBarrier(async () => {
      await Promise.resolve()
      calls.push('barrier-a')
    })
    service.registerShutdownBarrier(async () => {
      calls.push('barrier-b')
    })

    await service.onModuleDestroy()

    expect(calls.indexOf('disconnect')).toBeGreaterThan(calls.indexOf('barrier-a'))
    expect(calls.indexOf('disconnect')).toBeGreaterThan(calls.indexOf('barrier-b'))
    expect(calls).toContain('pool.end')
  })

  it('still disconnects and ends the pool when a barrier rejects (bounded log, no details)', async () => {
    service.registerShutdownBarrier(async () => {
      throw new Error('SECRET barrier failure')
    })

    await service.onModuleDestroy()

    expect(calls).toEqual(['disconnect', 'pool.end'])
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'prisma.shutdown_barrier_failed' },
      expect.any(String)
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SECRET')
  })

  it('continues with teardown when a barrier exceeds the safety cap (the cap does not cancel it)', async () => {
    jest.useFakeTimers()
    let finished = false
    service.registerShutdownBarrier(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            finished = true
            resolve()
          }, SHUTDOWN_BARRIER_MAX_MS * 5)
        })
    )

    const destroying = service.onModuleDestroy()
    await jest.advanceTimersByTimeAsync(SHUTDOWN_BARRIER_MAX_MS)
    await destroying

    expect(calls).toEqual(['disconnect', 'pool.end'])
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'prisma.shutdown_barrier_timeout' },
      expect.any(String)
    )
    expect(finished).toBe(false) // still running — cancellation was never promised
  })

  it('attempts pool.end even when $disconnect rejects, then surfaces the first error', async () => {
    jest.spyOn(service, '$disconnect').mockRejectedValue(new Error('disconnect failed'))

    await expect(service.onModuleDestroy()).rejects.toThrow('disconnect failed')

    expect(calls).toEqual(['pool.end'])
  })

  it('rejects a registration made after teardown has started', async () => {
    const destroying = service.onModuleDestroy()
    expect(() => service.registerShutdownBarrier(async () => undefined)).toThrow(
      'prisma_shutdown_barrier_registration_closed'
    )
    await destroying
  })
})
