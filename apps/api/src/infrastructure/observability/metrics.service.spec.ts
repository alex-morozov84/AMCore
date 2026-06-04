import { METRIC_NAMES } from './metrics.constants'
import { MetricsService } from './metrics.service'

import { EnvService } from '@/env/env.service'

describe('MetricsService', () => {
  const services: MetricsService[] = []

  function makeService(): MetricsService {
    const env = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PROCESS_ROLE: 'web',
          NODE_ENV: 'test',
          METRICS_ENABLED: true,
        }
        return values[key]
      }),
    } as unknown as EnvService
    const service = new MetricsService(env)
    services.push(service)
    return service
  }

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy()
    }
  })

  it('uses a private registry per service instance', async () => {
    const first = makeService()
    const second = makeService()

    first.observeHttpRequest({ method: 'GET', route: '/api/v1/health', status_code: '200' }, 0.01)

    const firstMetrics = await first.metrics()
    const secondMetrics = await second.metrics()

    expect(firstMetrics).toContain(METRIC_NAMES.httpRequestsTotal)
    expect(firstMetrics).toContain('route="/api/v1/health"')
    expect(secondMetrics).not.toContain('route="/api/v1/health"')
  })

  it('can construct two instances in one process without duplicate registration', () => {
    expect(() => {
      makeService()
      makeService()
    }).not.toThrow()
  })

  it('increments collector errors', async () => {
    const service = makeService()

    service.incCollectorError('queue_depth')

    const output = await service.metrics()
    const line = output
      .split('\n')
      .find((metricLine) => metricLine.startsWith(METRIC_NAMES.metricsCollectorErrorsTotal))

    expect(line).toContain('collector="queue_depth"')
    expect(line).toContain('node_env="test"')
    expect(line).toContain('role="web"')
    expect(line).toContain('service="amcore-api"')
    expect(line?.endsWith(' 1')).toBe(true)
  })
})
