import type { PinoLogger } from 'nestjs-pino'

import { logSlowQuery, resolveSlowQueryThresholdMs } from './prisma.service'

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
})
