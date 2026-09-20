import { DiskHealthIndicator, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'
import { ReadinessCheckService } from './readiness-check.service'

import { EnvService } from '@/env/env.service'
import { StorageHealthIndicator } from '@/infrastructure/storage'

describe('ReadinessCheckService', () => {
  let service: ReadinessCheckService
  let healthCheckService: jest.Mocked<HealthCheckService>
  let prismaIndicator: jest.Mocked<PrismaHealthIndicator>
  let redisIndicator: jest.Mocked<RedisHealthIndicator>
  let diskIndicator: jest.Mocked<DiskHealthIndicator>
  let memoryIndicator: jest.Mocked<MemoryHealthIndicator>
  let storageIndicator: jest.Mocked<StorageHealthIndicator>
  let env: jest.Mocked<EnvService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadinessCheckService,
        { provide: HealthCheckService, useValue: { check: jest.fn() } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: RedisHealthIndicator, useValue: { isHealthy: jest.fn() } },
        { provide: DiskHealthIndicator, useValue: { checkStorage: jest.fn() } },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
        { provide: StorageHealthIndicator, useValue: { isHealthy: jest.fn() } },
        {
          provide: EnvService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'HEALTH_DISK_THRESHOLD_PERCENT') return 0.9
              // STORAGE_HEALTH_ENABLED defaults to off → storage check skipped.
              return undefined
            }),
          },
        },
      ],
    }).compile()

    service = module.get(ReadinessCheckService)
    healthCheckService = module.get(HealthCheckService)
    prismaIndicator = module.get(PrismaHealthIndicator)
    redisIndicator = module.get(RedisHealthIndicator)
    diskIndicator = module.get(DiskHealthIndicator)
    memoryIndicator = module.get(MemoryHealthIndicator)
    storageIndicator = module.get(StorageHealthIndicator)
    env = module.get(EnvService)
  })

  const runCheck = async (): Promise<void> => {
    prismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } } as any)
    redisIndicator.isHealthy.mockResolvedValue({ redis: { status: 'up' } } as any)
    diskIndicator.checkStorage.mockResolvedValue({ disk: { status: 'up' } } as any)
    memoryIndicator.checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } } as any)
    healthCheckService.check.mockImplementation(async (indicators) => {
      await Promise.all(indicators.map((indicator) => indicator()))
      return { status: 'ok' } as any
    })
    await service.check()
  }

  it('checks database, redis, disk and memory', async () => {
    await runCheck()

    expect(prismaIndicator.isHealthy).toHaveBeenCalledWith('database')
    expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis')
    expect(env.get).toHaveBeenCalledWith('HEALTH_DISK_THRESHOLD_PERCENT')
    expect(diskIndicator.checkStorage).toHaveBeenCalledWith('disk', {
      thresholdPercent: 0.9,
      path: '/',
    })
    expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', 1024 * 1024 * 1024)
  })

  it('uses the HEALTH_MEMORY_HEAP_BYTES override when set', async () => {
    const override = 8 * 1024 * 1024 * 1024
    env.get.mockImplementation((key: string) =>
      key === 'HEALTH_MEMORY_HEAP_BYTES'
        ? override
        : key === 'HEALTH_DISK_THRESHOLD_PERCENT'
          ? 0.9
          : undefined
    )
    await runCheck()

    expect(memoryIndicator.checkHeap).toHaveBeenCalledWith('memory_heap', override)
    expect(memoryIndicator.checkHeap).not.toHaveBeenCalledWith('memory_heap', 1024 * 1024 * 1024)
  })

  describe('storage health (opt-in)', () => {
    it('excludes storage by default', async () => {
      await runCheck()
      expect(storageIndicator.isHealthy).not.toHaveBeenCalled()
    })

    it('includes storage when STORAGE_HEALTH_ENABLED is true', async () => {
      env.get.mockImplementation((key: string) => {
        if (key === 'HEALTH_DISK_THRESHOLD_PERCENT') return 0.9 as never
        if (key === 'STORAGE_HEALTH_ENABLED') return true as never
        return undefined as never
      })
      storageIndicator.isHealthy.mockResolvedValue({ storage: { status: 'up' } } as any)
      await runCheck()
      expect(storageIndicator.isHealthy).toHaveBeenCalledWith('storage')
    })
  })
})
