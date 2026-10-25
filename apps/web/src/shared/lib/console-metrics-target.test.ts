// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  assertConsoleMetricsTarget,
  CONSOLE_METRICS_GRAFANA_ENV,
  getConsoleMetricsTarget,
} from './console-metrics-target'
describe('optional contextual metrics target', () => {
  it.each([undefined, '', '   '])('accepts unset %s', (raw) => {
    expect(getConsoleMetricsTarget({ [CONSOLE_METRICS_GRAFANA_ENV]: raw })).toBeNull()
    expect(() => assertConsoleMetricsTarget({ [CONSOLE_METRICS_GRAFANA_ENV]: raw })).not.toThrow()
  })
  it('reads a dashboard at request time and refuses a configured generic Metrics home', () => {
    expect(
      getConsoleMetricsTarget({
        [CONSOLE_METRICS_GRAFANA_ENV]: ' https://metrics.example.test/d/demo ',
      })
    ).toBe('https://metrics.example.test/d/demo')
    const env = { [CONSOLE_METRICS_GRAFANA_ENV]: 'https://metrics.example.test/' }
    expect(getConsoleMetricsTarget(env)).toBeNull()
    expect(() => assertConsoleMetricsTarget(env)).toThrow(CONSOLE_METRICS_GRAFANA_ENV)
  })
})
