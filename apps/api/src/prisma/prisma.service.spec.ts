import type { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../env/env.service'
import { MetricsService } from '../infrastructure/observability'

import {
  handleSlowQuery,
  logSlowQuery,
  PrismaService,
  resolveSlowQueryThresholdMs,
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
