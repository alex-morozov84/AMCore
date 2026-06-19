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
    jest.useRealTimers()
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

  it('registers a scrape-time gauge without exposing the registry', async () => {
    const service = makeService()
    let value = 3

    service.registerGauge<'state'>({
      name: 'amcore_test_connections',
      help: 'Test connections.',
      labelNames: ['state'],
      collect: (gauge) => {
        gauge.reset()
        gauge.set({ state: 'active' }, value)
      },
    })

    expect(await service.metrics()).toMatch(/amcore_test_connections\{[^}]*state="active"[^}]*} 3/)

    value = 7
    expect(await service.metrics()).toMatch(/amcore_test_connections\{[^}]*state="active"[^}]*} 7/)
  })

  it('returns collector fallback and counts errors', async () => {
    const service = makeService()

    const result = await service.withCollectorTimeout(
      'queue_depth',
      Promise.reject(new Error('redis down')),
      []
    )

    expect(result).toEqual([])
    expect(await service.metrics()).toContain(
      `${METRIC_NAMES.metricsCollectorErrorsTotal}{collector="queue_depth"`
    )
  })

  it('bounds a stalled collector with a timeout', async () => {
    jest.useFakeTimers()
    const service = makeService()

    const pending = service.withCollectorTimeout(
      'queue_depth',
      new Promise<number>(() => undefined),
      0
    )
    await jest.advanceTimersByTimeAsync(150)

    await expect(pending).resolves.toBe(0)
  })

  it('increments bounded DB and Redis event counters', async () => {
    const service = makeService()

    service.incDbSlowQuery()
    service.incRedisClientEvent('shared', 'error')
    service.incRedisClientEvent('throttler', 'degraded')
    service.incQueueEvent('email', 'job_added')

    const output = await service.metrics()
    expect(output).toContain(`${METRIC_NAMES.dbSlowQueriesTotal}{role="web"`)
    expect(output).toContain('client="shared",event="error",role="web"')
    expect(output).toContain('client="throttler",event="degraded",role="web"')
    expect(output).toContain('queue="email",event="job_added",role="web"')
  })

  it('records realtime notification publish outcomes with bounded labels', async () => {
    const service = makeService()

    service.incNotificationRealtimePublish('published')
    service.incNotificationRealtimePublish('failed')
    service.incNotificationRealtimePublish('dropped')

    const output = await service.metrics()
    expect(output).toContain(
      `${METRIC_NAMES.notificationRealtimePublishTotal}{outcome="published",role="web"`
    )
    expect(output).toContain('outcome="failed",role="web"')
    expect(output).toContain('outcome="dropped",role="web"')
  })

  it('tracks the realtime connections gauge and bounded stream events', async () => {
    const service = makeService()

    service.incNotificationRealtimeConnections()
    service.incNotificationRealtimeConnections()
    service.decNotificationRealtimeConnections()
    service.incNotificationRealtimeEvent('rejected_user')

    const output = await service.metrics()
    // 2 opened − 1 closed → gauge at 1 for this role.
    expect(output).toContain(`${METRIC_NAMES.notificationRealtimeConnections}{role="web"`)
    expect(output).toMatch(
      new RegExp(`${METRIC_NAMES.notificationRealtimeConnections}\\{role="web"[^}]*\\} 1`)
    )
    expect(output).toContain(
      `${METRIC_NAMES.notificationRealtimeEventsTotal}{event="rejected_user",role="web"`
    )
  })

  it('records bounded cache, storage, media, and email metrics', async () => {
    const service = makeService()

    service.incCacheOperation('user', 'negative_hit')
    service.observeStorageOperation('s3', 'upload', 'success', 0.25)
    service.observeMediaOperation('avatar', 'process', 'error', 0.5)
    service.observeEmailOperation(
      {
        template: 'welcome',
        operation: 'send',
        mode: 'worker',
        result: 'error',
        retryable: 'true',
      },
      0.75
    )
    service.incEmailDeadLetter('welcome', false)

    const output = await service.metrics()
    expect(output).toContain('cache="user",result="negative_hit",role="web"')
    expect(output).toContain('driver="s3",operation="upload",result="success",role="web"')
    expect(output).toContain('preset="avatar",operation="process",result="error",role="web"')
    expect(output).toContain(
      'template="welcome",operation="send",mode="worker",result="error",retryable="true",role="web"'
    )
    expect(output).toContain('template="welcome",unrecoverable="false",role="web"')
  })
})
