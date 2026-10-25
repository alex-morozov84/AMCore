import { describe, expect, it } from 'vitest'

import { consoleMetricsHref, parseConsoleMetricsDashboard } from './console-metrics-link'

const at = '2026-10-25T12:00:00.000Z'
describe('contextual Grafana dashboard links', () => {
  it.each([
    'https://metrics.example.test/d/amcore/overview',
    'https://metrics.example.test/grafana/d/abc_12/',
    'http://localhost:3002/d/demo',
  ])('accepts dashboard %s', (value) => {
    expect(parseConsoleMetricsDashboard(value)).not.toBeNull()
  })
  it.each([
    'https://metrics.example.test/',
    'https://metrics.example.test/explore',
    'https://metrics.example.test/d-solo/demo',
    'https://metrics.example.test/d/',
    'https://user:password@metrics.example.test/d/demo',
    'http://metrics.example.test/d/demo',
    'javascript:alert(1)',
    '/d/demo',
  ])('refuses incompatible or unsafe %s', (value) => {
    expect(parseConsoleMetricsDashboard(value)).toBeNull()
  })
  it('preserves path/query/hash and replaces conflicting time controls without adding identifiers', () => {
    const url = new URL(
      consoleMetricsHref(
        'https://metrics.example.test/grafana/d/demo/summary?orgId=1&from=old&from=older&to=old&time=now&time.window=2h&var-service=api#panel',
        at
      )!
    )
    expect(url.pathname).toBe('/grafana/d/demo/summary')
    expect(url.hash).toBe('#panel')
    expect([...url.searchParams.keys()].sort()).toEqual(['from', 'orgId', 'to', 'var-service'])
    expect(url.searchParams.getAll('from')).toEqual([String(Date.parse(at) - 900000)])
    expect(url.searchParams.get('to')).toBe(String(Date.parse(at) + 900000))
  })
  it.each([
    null,
    undefined,
    '',
    'invalid',
    '1970-01-01T00:00:00.000Z',
    '+275760-09-13T00:00:00.000Z',
  ])('omits missing or unrepresentable observation %s', (time) => {
    expect(consoleMetricsHref('https://metrics.example.test/d/demo', time)).toBeNull()
  })
  it('omits unset target', () => expect(consoleMetricsHref(null, at)).toBeNull())
})
