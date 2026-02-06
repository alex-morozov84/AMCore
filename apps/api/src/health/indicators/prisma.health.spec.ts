import { HealthIndicatorService } from '@nestjs/terminus'

import { PrismaHealthIndicator } from './prisma.health'

import { PrismaService } from '@/prisma/prisma.service'

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator
  let prisma: jest.Mocked<PrismaService>
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>
  let mockIndicator: { up: jest.Mock; down: jest.Mock }

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>

    mockIndicator = {
      up: jest.fn().mockReturnValue({ database: { status: 'up' } }),
      down: jest.fn().mockReturnValue({ database: { status: 'down' } }),
    }

    healthIndicatorService = {
      check: jest.fn().mockReturnValue(mockIndicator),
    } as unknown as jest.Mocked<HealthIndicatorService>

    indicator = new PrismaHealthIndicator(prisma, healthIndicatorService)
  })

  it('should return healthy status when database is accessible', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

    const result = await indicator.isHealthy('database')

    expect(healthIndicatorService.check).toHaveBeenCalledWith('database')
    expect(mockIndicator.up).toHaveBeenCalled()
    expect(result).toEqual({ database: { status: 'up' } })
  })

  it('should return unhealthy status when database is not accessible', async () => {
    const error = new Error('Connection refused')
    prisma.$queryRaw.mockRejectedValue(error)

    mockIndicator.down.mockReturnValue({
      database: { status: 'down', message: 'Connection refused' },
    })

    const result = await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Connection refused' })
    expect(result).toEqual({ database: { status: 'down', message: 'Connection refused' } })
  })

  it('should handle non-Error exceptions', async () => {
    prisma.$queryRaw.mockRejectedValue('Unknown error')

    mockIndicator.down.mockReturnValue({
      database: { status: 'down', message: 'Database connection failed' },
    })

    const result = await indicator.isHealthy('database')

    expect(mockIndicator.down).toHaveBeenCalledWith({ message: 'Database connection failed' })
    expect(result).toEqual({ database: { status: 'down', message: 'Database connection failed' } })
  })
})
