import { HealthIndicatorService } from '@nestjs/terminus'

import { PrismaHealthIndicator } from './prisma.health'

import type { EnvService } from '@/env/env.service'
import { PrismaService } from '@/prisma/prisma.service'

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator
  let prisma: jest.Mocked<PrismaService>
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>
  let env: jest.Mocked<EnvService>
  let mockIndicator: { up: jest.Mock; down: jest.Mock }

  const makeIndicator = (
    waitingThreshold: number,
    poolStats = { total: 1, idle: 1, waiting: 0 }
  ) => {
    prisma = {
      $queryRaw: jest.fn(),
      getPoolStats: jest.fn().mockReturnValue(poolStats),
    } as unknown as jest.Mocked<PrismaService>

    mockIndicator = {
      up: jest.fn().mockImplementation((details) => ({ database: { status: 'up', ...details } })),
      down: jest
        .fn()
        .mockImplementation((details) => ({ database: { status: 'down', ...details } })),
    }

    healthIndicatorService = {
      check: jest.fn().mockReturnValue(mockIndicator),
    } as unknown as jest.Mocked<HealthIndicatorService>

    env = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'DATABASE_POOL_WAITING_THRESHOLD') return waitingThreshold
        return undefined
      }),
    } as unknown as jest.Mocked<EnvService>

    indicator = new PrismaHealthIndicator(prisma, healthIndicatorService, env)
  }

  it('returns healthy status with pool snapshot when DB is accessible and pool is idle', async () => {
    makeIndicator(5, { total: 10, idle: 8, waiting: 0 })
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    const result = await indicator.isHealthy('database')

    expect(healthIndicatorService.check).toHaveBeenCalledWith('database')
    expect(mockIndicator.up).toHaveBeenCalledWith({ pool: { total: 10, idle: 8, waiting: 0 } })
    expect(result).toEqual({
      database: { status: 'up', pool: { total: 10, idle: 8, waiting: 0 } },
    })
  })

  it('returns unhealthy status when SELECT 1 fails (DB unreachable)', async () => {
    makeIndicator(5)
    const error = new Error('Connection refused')
    prisma.$queryRaw.mockRejectedValue(error)

    const result = await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Connection refused' })
    expect(prisma.getPoolStats).not.toHaveBeenCalled()
    expect(result.database?.status).toBe('down')
  })

  it('handles non-Error exceptions from $queryRaw', async () => {
    makeIndicator(5)
    prisma.$queryRaw.mockRejectedValue('Unknown error')

    await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Database connection failed' })
  })

  it('returns unhealthy when waiting count is above the threshold', async () => {
    makeIndicator(5, { total: 10, idle: 0, waiting: 12 })
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    const result = await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalledWith({
      pool: { total: 10, idle: 0, waiting: 12 },
      message: 'pool saturated: 12 waiting (threshold 5)',
    })
    expect(result.database?.status).toBe('down')
  })

  it('stays healthy when waiting count equals the threshold (strict greater-than)', async () => {
    makeIndicator(5, { total: 10, idle: 0, waiting: 5 })
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    await indicator.isHealthy('database')

    expect(mockIndicator.up).toHaveBeenCalledWith({ pool: { total: 10, idle: 0, waiting: 5 } })
    expect(mockIndicator.down).not.toHaveBeenCalled()
  })

  it('threshold = 0 fails readiness as soon as any request is queued', async () => {
    makeIndicator(0, { total: 10, idle: 0, waiting: 1 })
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalled()
  })
})
