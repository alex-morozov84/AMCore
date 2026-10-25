import { parseConsoleMetricsDashboard } from './console-metrics-link'

import 'server-only'

export const CONSOLE_METRICS_GRAFANA_ENV = 'ADMIN_CONSOLE_METRICS_GRAFANA_URL'
type MetricsEnvironment = Record<string, string | undefined>
export function getConsoleMetricsTarget(env: MetricsEnvironment = process.env): string | null {
  return parseConsoleMetricsDashboard(env[CONSOLE_METRICS_GRAFANA_ENV])
}
export function assertConsoleMetricsTarget(env: MetricsEnvironment = process.env): void {
  const raw = env[CONSOLE_METRICS_GRAFANA_ENV]?.trim()
  if (raw && !parseConsoleMetricsDashboard(raw))
    throw new Error(
      `${CONSOLE_METRICS_GRAFANA_ENV} must be an absolute safe Grafana dashboard URL with a /d/<uid> path`
    )
}
