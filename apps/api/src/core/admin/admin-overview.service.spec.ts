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
        return undefined
      }) as any,
    }
    service = new AdminOverviewService(readiness as any, env as any)
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

    expect(result).toEqual({
      readiness: 'ready',
      dependencies: [
        { name: 'database', status: 'up' },
        { name: 'redis', status: 'up' },
      ],
      version: '1.2.3',
      processRole: 'all',
    })
  })

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

  it('propagates a non-readiness error instead of misreporting it as not_ready', async () => {
    readiness.check.mockRejectedValue(new Error('unexpected'))

    await expect(service.getOverview()).rejects.toThrow('unexpected')
  })
})
