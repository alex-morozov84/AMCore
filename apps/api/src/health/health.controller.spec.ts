import {
  DiskHealthIndicator,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { Test, TestingModule } from '@nestjs/testing'

import { HealthController } from './health.controller'
import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'

describe('HealthController', () => {
  let controller: HealthController
  let healthCheckService: jest.Mocked<HealthCheckService>
  let prismaIndicator: jest.Mocked<PrismaHealthIndicator>
  let redisIndicator: jest.Mocked<RedisHealthIndicator>
  let diskIndicator: jest.Mocked<DiskHealthIndicator>
  let memoryIndicator: jest.Mocked<MemoryHealthIndicator>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(),
          },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: {
            isHealthy: jest.fn(),
          },
        },
        {
          provide: RedisHealthIndicator,
          useValue: {
            isHealthy: jest.fn(),
          },
        },
        {
          provide: DiskHealthIndicator,
          useValue: {
            checkStorage: jest.fn(),
          },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: {
            checkHeap: jest.fn(),
          },
        },
        {
          provide: HttpHealthIndicator,
          useValue: {
            pingCheck: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get<HealthController>(HealthController)
    healthCheckService = module.get(HealthCheckService)
    prismaIndicator = module.get(PrismaHealthIndicator)
    redisIndicator = module.get(RedisHealthIndicator)
    diskIndicator = module.get(DiskHealthIndicator)
    memoryIndicator = module.get(MemoryHealthIndicator)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('startup', () => {
    it('should check database and redis connectivity', async () => {
      const mockResult = {
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
        error: {},
        details: {},
      }

      prismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } } as any)
      redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } } as any)

      // Make healthCheckService.check actually call the indicator functions
      healthCheckService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((indicator) => indicator()))
        return mockResult as any
      })

      const result = await controller.startup()

      expect(result).toEqual(mockResult)
      expect(healthCheckService.check).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function), expect.any(Function)])
      )
      expect(prismaIndicator.isHealthy).toHaveBeenCalledWith('database')
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis')
    })
  })

  describe('ready', () => {
    it('should perform full health check (database, redis, disk, memory)', async () => {
      const mockResult = {
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
          disk: { status: 'up' },
          memory_heap: { status: 'up' },
        },
        error: {},
        details: {},
      }

      prismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } } as any)
      redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } } as any)
      diskIndicator.checkStorage.mockResolvedValue({ disk: { status: 'up' } } as any)
      memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any)

      healthCheckService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((indicator) => indicator()))
        return mockResult as any
      })

      const result = await controller.ready()

      expect(result).toEqual(mockResult)
      expect(healthCheckService.check).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function), // database
          expect.any(Function), // redis
          expect.any(Function), // disk
          expect.any(Function), // memory
        ])
      )
      expect(prismaIndicator.isHealthy).toHaveBeenCalledWith('database')
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis')
      expect(diskIndicator.checkStorage).toHaveBeenCalledWith('disk', {
        thresholdPercent: 0.9,
        path: '/',
      })
      expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', 1024 * 1024 * 1024)
    })
  })

  describe('live', () => {
    it('should perform simple liveness check (memory only)', async () => {
      const mockResult = {
        status: 'ok',
        info: {
          memory_heap: { status: 'up' },
        },
        error: {},
        details: {},
      }

      memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any)

      healthCheckService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((indicator) => indicator()))
        return mockResult as any
      })

      const result = await controller.live()

      expect(result).toEqual(mockResult)
      expect(healthCheckService.check).toHaveBeenCalledWith([expect.any(Function)])
      expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', 1536 * 1024 * 1024)
    })
  })

  describe('check', () => {
    it('should perform general health check', async () => {
      const mockResult = {
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
          disk: { status: 'up' },
          memory_heap: { status: 'up' },
        },
        error: {},
        details: {},
      }

      prismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } } as any)
      redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } } as any)
      diskIndicator.checkStorage.mockResolvedValue({ disk: { status: 'up' } } as any)
      memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any)

      healthCheckService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((indicator) => indicator()))
        return mockResult as any
      })

      const result = await controller.check()

      expect(result).toEqual(mockResult)
      expect(prismaIndicator.isHealthy).toHaveBeenCalledWith('database')
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis')
      expect(diskIndicator.checkStorage).toHaveBeenCalledWith('disk', {
        thresholdPercent: 0.9,
        path: '/',
      })
      expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', 300 * 1024 * 1024)
    })
  })
})
