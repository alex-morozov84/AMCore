import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client'

import { MetricsService } from './metrics.service'

import type { EnvService } from '@/env/env.service'

function service(): MetricsService {
  const values: Record<string, unknown> = {
    PROCESS_ROLE: 'web',
    NODE_ENV: 'test',
    METRICS_ENABLED: true,
  }
  return new MetricsService({ get: (key: string) => values[key] } as EnvService)
}

describe('metrics client contracts', () => {
  it('retains the first collector and clears the private registry on close', async () => {
    const metrics = service()
    const first = jest.fn((gauge) => gauge.set(7))
    const second = jest.fn((gauge) => gauge.set(9))
    try {
      metrics.registerGauge<never>({
        name: 'amcore_first',
        help: 'First collector.',
        labelNames: [],
        collect: first,
      })
      metrics.registerGauge<never>({
        name: 'amcore_first',
        help: 'First collector.',
        labelNames: [],
        collect: second,
      })
      const outputs = await Promise.all([metrics.metrics(), metrics.metrics()])
      expect(
        outputs.every((output) =>
          output.includes('amcore_first{service="amcore-api",role="web",node_env="test"} 7')
        )
      ).toBe(true)
      expect(first).toHaveBeenCalledTimes(2)
      expect(second).not.toHaveBeenCalled()
    } finally {
      metrics.onModuleDestroy()
    }
    expect((await metrics.metrics()).trim()).toBe('')
  })

  it('distinguishes absent labeled data from the zero-label reset series', async () => {
    const registry = new Registry()
    const bare = new Gauge({ name: 'bare', help: 'Bare.', registers: [registry] })
    const labeled = new Gauge<'state'>({
      name: 'labeled',
      help: 'Labeled.',
      labelNames: ['state'],
      registers: [registry],
    })
    bare.set(3)
    labeled.set({ state: 'ready' }, 4)
    bare.reset()
    labeled.reset()
    const output = await registry.metrics()
    expect(output).toContain('bare 0')
    expect(output).not.toContain('labeled{')
    registry.clear()
  })

  it('preserves cumulative buckets, counters, labels and selected exposition formats', async () => {
    const registry = new Registry()
    registry.setDefaultLabels({ service: 'probe' })
    const counter = new Counter<'kind'>({
      name: 'count_total',
      help: 'Count.',
      labelNames: ['kind'],
      registers: [registry],
    })
    const histogram = new Histogram({
      name: 'duration_seconds',
      help: 'Duration.',
      buckets: [0.1, 1],
      registers: [registry],
    })
    counter.inc({ kind: 'safe' }, 2)
    histogram.observe(0.5)
    expect((await counter.get()).values).toHaveLength(1)
    expect((await counter.get()).values[0]?.value).toBe(2)
    const output = await registry.metrics()
    expect(output).toContain('count_total{kind="safe",service="probe"} 2')
    expect(output).toContain('duration_seconds_bucket{le="0.1",service="probe"} 0')
    expect(output).toContain('duration_seconds_bucket{le="1",service="probe"} 1')
    expect(output).toContain('duration_seconds_bucket{le="+Inf",service="probe"} 1')
    expect(output).toContain('duration_seconds_sum{service="probe"} 0.5')
    expect(output).toContain('duration_seconds_count{service="probe"} 1')
    expect(registry.contentType).toBe(Registry.PROMETHEUS_CONTENT_TYPE)
    registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE)
    expect((await registry.metrics()).trimEnd()).toMatch(/# EOF$/)
    expect(registry.contentType).toBe(Registry.OPENMETRICS_CONTENT_TYPE)
    registry.clear()
  })
})
