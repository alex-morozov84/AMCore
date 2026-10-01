import { ServiceUnavailableException } from '@nestjs/common'

import { AdminOverviewService } from './admin-overview.service'

import type { EnvService } from '@/env/env.service'
import type { ReadinessCheckService } from '@/health'

describe('AdminOverviewService', () => {
  let service: AdminOverviewService
  let readiness: jest.Mocked<Pick<ReadinessCheckService, 'check'>>
  let env: jest.Mocked<Pick<EnvService, 'get'>>

  beforeEach(() => {
    readiness = { check: jest.fn() }
    env = {
      get: jest.fn((key: string) => {
        if (key === 'APP_VERSION') return '1.2.3'
        if (key === 'PROCESS_ROLE') return 'all'
        if (key === 'APP_COMMIT') return 'unknown'
        if (key === 'NODE_ENV') return 'test'
        if (key === 'STORAGE_HEALTH_ENABLED') return false
        return undefined
      }) as any,
    }
    service = new AdminOverviewService(
      readiness as any,
      env as any,
      {
        sample: jest.fn().mockResolvedValue({
          process: {
            instanceId: '123e4567-e89b-42d3-a456-426614174000',
            uptimeSeconds: 42,
            sampledAt: '2026-09-30T12:00:00.000Z',
          },
          resources: {
            pool: { status: 'unavailable', sampledAt: null },
            memory: { status: 'unavailable', sampledAt: null },
            filesystem: { status: 'unavailable', sampledAt: null },
          },
        }),
      } as any,
      {
        snapshot: () => ({
          state: 'unknown',
          driver: 'memory',
          checkedAt: null,
          nextScheduledAt: null,
          inProgress: false,
          failure: null,
          stage: null,
          intervalSeconds: 60,
          staleAfterSeconds: 180,
        }),
      } as any
    )
  })

  it('reports observed readiness with sanitized dependency statuses', async () => {
    readiness.check.mockResolvedValue({
      status: 'ok',
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    } as any)

    const result = await service.getOverview()

    expect(result).toMatchObject({
      readiness: 'ready',
      dependencies: [
        { name: 'database', status: 'up' },
        { name: 'redis', status: 'up' },
      ],
      version: '1.2.3',
      processRole: 'all',
    })
  })

  it('preserves fulfilled degraded readiness and sanitizes its dependency', async () => {
    readiness.check.mockResolvedValue({
      status: 'degraded',
      details: { redis: { status: 'degraded', message: 'private-provider-detail' } },
    } as any)

    const result = await service.getOverview()

    expect(result.readiness).toBe('degraded')
    expect(result.dependencies).toEqual([{ name: 'redis', status: 'degraded' }])
    expect(JSON.stringify(result)).not.toContain('private-provider-detail')
  })

  it.each(['error', 'shutting_down', 'unexpected'])(
    'rejects unexpected fulfilled overall status %s rather than reporting ready',
    async (status) => {
      readiness.check.mockResolvedValue({ status, details: {} } as any)
      await expect(service.getOverview()).rejects.toThrow('Unexpected readiness result')
    }
  )

  it('reports an observed not-ready instance as a typed 200, never as an HTTP error', async () => {
    readiness.check.mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        details: {
          database: { status: 'up' },
          redis: { status: 'down', message: 'ECONNREFUSED 10.0.0.5:6379' },
        },
      })
    )

    const result = await service.getOverview()

    expect(result.readiness).toBe('not_ready')
    expect(result.dependencies).toEqual([
      { name: 'database', status: 'up' },
      { name: 'redis', status: 'down' },
    ])
    // Sanitized: the raw indicator message never reaches the response.
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED')
  })

  it('maps an unrecognized dependency status to unknown rather than leaking it verbatim', async () => {
    readiness.check.mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        details: { disk: { status: 'shutting_down' } },
      })
    )

    const result = await service.getOverview()

    expect(result.dependencies).toEqual([{ name: 'disk', status: 'unknown' }])
  })

  it('drops a dependency name outside the allowlist, never forwarding it to the browser', async () => {
    readiness.check.mockResolvedValue({
      status: 'ok',
      details: {
        database: { status: 'up' },
        some_future_indicator: { status: 'up' },
      },
    } as any)

    const result = await service.getOverview()

    expect(result.dependencies).toEqual([{ name: 'database', status: 'up' }])
    expect(JSON.stringify(result)).not.toContain('some_future_indicator')
  })

  it('propagates a non-readiness error instead of misreporting it as not_ready', async () => {
    readiness.check.mockRejectedValue(new Error('unexpected'))

    await expect(service.getOverview()).rejects.toThrow('unexpected')
  })

  it('keeps independently sampled healthy numbers alongside readiness-down', async () => {
    readiness.check.mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        details: { memory_heap: { status: 'down' } },
      })
    )
    const independent = {
      process: {
        instanceId: '123e4567-e89b-42d3-a456-426614174000',
        uptimeSeconds: 1,
        sampledAt: '2026-09-30T12:00:01.000Z',
      },
      resources: {
        pool: { status: 'unavailable', sampledAt: null },
        filesystem: { status: 'unavailable', sampledAt: null },
        memory: {
          status: 'available',
          sampledAt: '2026-09-30T12:00:01.000Z',
          heapUsedBytes: 10,
          rssBytes: 30,
          readinessHeapLimitBytes: 100,
        },
      },
    }
    const subject = new AdminOverviewService(
      readiness as any,
      env as any,
      {
        sample: async () => independent,
      } as any,
      {
        snapshot: () => ({
          state: 'unknown',
          driver: 'memory',
          checkedAt: null,
          nextScheduledAt: null,
          inProgress: false,
          failure: null,
          stage: null,
          intervalSeconds: 60,
          staleAfterSeconds: 180,
        }),
      } as any
    )
    const result = await subject.getOverview()
    expect(result.readiness).toBe('not_ready')
    expect(result.dependencies).toEqual([{ name: 'memory_heap', status: 'down' }])
    expect(result.resources.memory).toEqual(independent.resources.memory)
  })

  it.each(['unknown', 'secret://provider.example', 'x'.repeat(129), ''])(
    'projects invalid version %p to honest unknown',
    async (version) => {
      readiness.check.mockResolvedValue({ status: 'ok', details: {} } as any)
      const original = env.get.getMockImplementation()!
      env.get.mockImplementation(((key: string) =>
        key === 'APP_VERSION' ? version : original(key as never)) as any)
      const result = await service.getOverview()
      expect(result.version).toBe('unknown')
      expect(result.api.version).toBeNull()
    }
  )
})
