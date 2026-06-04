export const METRICS_ROUTE = 'metrics'
export const METRICS_HTTP_PATH = '/api/v1/metrics'

export const METRIC_NAMES = {
  httpRequestsTotal: 'amcore_http_requests_total',
  httpRequestDurationSeconds: 'amcore_http_request_duration_seconds',
  httpRequestsInFlight: 'amcore_http_requests_in_flight',
  metricsCollectorErrorsTotal: 'amcore_metrics_collector_errors_total',
} as const
