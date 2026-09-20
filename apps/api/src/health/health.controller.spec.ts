import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus'
import { Test, TestingModule } from '@nestjs/testing'

import { AuthType } from '@amcore/shared'

import { HealthController } from './health.controller'
import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'
import { ReadinessCheckService } from './readiness-check.service'

import { AUTH_TYPE_KEY } from '@/core/auth/decorators/auth.decorator'
import { EnvService } from '@/env/env.service'

describe('HealthController', () => {
  let controller: HealthController
  let readiness: jest.Mocked<ReadinessCheckService>
  let healthCheckService: jest.Mocked<HealthCheckService>
  let prismaIndicator: jest.Mocked<PrismaHealthIndicator>
  let redisIndicator: jest.Mocked<RedisHealthIndicator>
  let memoryIndicator: jest.Mocked<MemoryHealthIndicator>
  let env: jest.Mocked<EnvService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ReadinessCheckService, useValue: { check: jest.fn() } },
        { provide: HealthCheckService, useValue: { check: jest.fn() } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: RedisHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
        {
          provide: EnvService,
          useValue: { get: jest.fn(() => undefined) },
        },
      ],
    }).compile()

    controller = module.get(HealthController)
    readiness = module.get(ReadinessCheckService)
    healthCheckService = module.get(HealthCheckService)
    prismaIndicator = module.get(PrismaHealthIndicator)
    redisIndicator = module.get(RedisHealthIndicator)
    memoryIndicator = module.get(MemoryHealthIndicator)
    env = module.get(EnvService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should be public for all health endpoints', () => {
    const authTypes = Reflect.getMetadata(AUTH_TYPE_KEY, HealthController) as AuthType[]

    expect(authTypes).toEqual([AuthType.None])
  })

  describe('startup', () => {
    it('should check database and redis connectivity', async () => {
      const mockResult = {
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: {},
      }

      prismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } } as any)
      redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } } as any)
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
    it('delegates to ReadinessCheckService', async () => {
      const mockResult = { status: 'ok', details: {} } as any
      readiness.check.mockResolvedValue(mockResult)

      const result = await controller.ready()

      expect(result).toBe(mockResult)
      expect(readiness.check).toHaveBeenCalled()
    })
  })

  describe('check', () => {
    it('delegates to ReadinessCheckService (alias of readiness)', async () => {
      const mockResult = { status: 'ok', details: {} } as any
      readiness.check.mockResolvedValue(mockResult)

      const result = await controller.check()

      expect(result).toBe(mockResult)
      expect(readiness.check).toHaveBeenCalled()
    })
  })

  describe('live', () => {
    it('should perform simple liveness check (memory only)', async () => {
      const mockResult = {
        status: 'ok',
        info: { memory_heap: { status: 'up' } },
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

    it('uses the HEALTH_MEMORY_HEAP_BYTES override when set', async () => {
      const override = 8 * 1024 * 1024 * 1024
      env.get.mockImplementation((key: string) =>
        key === 'HEALTH_MEMORY_HEAP_BYTES' ? override : undefined
      )
      memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any)
      healthCheckService.check.mockImplementation(async (indicators) => {
        await Promise.all(indicators.map((indicator) => indicator()))
        return { status: 'ok' } as any
      })

      await controller.live()

      expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', override)
    })
  })
})
