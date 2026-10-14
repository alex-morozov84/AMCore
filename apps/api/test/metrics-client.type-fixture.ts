import {
  Counter,
  Gauge,
  Histogram,
  type MetricType,
  type MetricValue,
  Registry,
} from '@prometheus-io/client'

// These compile-only contracts run through required API typecheck, never at runtime.
export function validMetricCalls(): void {
  const registry = new Registry()
  const counter = new Counter<'method' | 'route'>({
    name: 'typed_total',
    help: 'Typed.',
    labelNames: ['method', 'route'],
    registers: [registry],
  })
  counter.inc({ method: 'GET', route: '/safe' })
  const gauge = new Gauge({ name: 'bare', help: 'Bare.', registers: [registry] })
  gauge.set(1)
  const histogram = new Histogram<'role'>({
    name: 'time_seconds',
    help: 'Time.',
    labelNames: ['role'],
    registers: [registry],
  })
  histogram.observe({ role: 'web' }, 0.1)
  const type: MetricType = 'counter'
  void type
}

export function invalidMetricCalls(): void {
  const counter = new Counter<'method'>({
    name: 'typed_total',
    help: 'Typed.',
    labelNames: ['method'],
    registers: [],
  })
  // @ts-expect-error Unknown label key must remain rejected.
  counter.inc({ privateUserId: 'secret' })
  // @ts-expect-error Label values must not accept arbitrary objects.
  counter.inc({ method: { unsafe: true } })
  // @ts-expect-error Histogram values must remain numeric.
  new Histogram({ name: 'time_seconds', help: 'Time.', registers: [] }).observe('invalid')
  // @ts-expect-error MetricType is a closed string union.
  const type: MetricType = 'unknown'
  void type
}

export function documentedReadbackLimit(sample: MetricValue<'method' | 'route'>): void {
  // Known upstream issue861: distributive LabelValues loses simultaneous keys.
  // This is a library regression fixture, not an application compatibility cast.
  // @ts-expect-error Current0.16.1 readback cannot access both union keys directly.
  void sample.labels.method
  if ('method' in sample.labels) {
    const method: string | number | undefined = sample.labels.method
    void method
  }
}
