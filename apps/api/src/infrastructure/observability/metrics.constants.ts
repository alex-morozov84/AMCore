export const METRICS_ROUTE = 'metrics'
export const METRICS_HTTP_PATH = '/api/v1/metrics'
export const METRICS_COLLECTOR_TIMEOUT_MS = 100

export const METRIC_NAMES = {
  httpRequestsTotal: 'amcore_http_requests_total',
  httpRequestDurationSeconds: 'amcore_http_request_duration_seconds',
  httpRequestsInFlight: 'amcore_http_requests_in_flight',
  metricsCollectorErrorsTotal: 'amcore_metrics_collector_errors_total',
  dbPoolConnections: 'amcore_db_pool_connections',
  dbSlowQueriesTotal: 'amcore_db_slow_queries_total',
  redisClientEventsTotal: 'amcore_redis_client_events_total',
  queueJobs: 'amcore_queue_jobs',
  queueEventsTotal: 'amcore_queue_events_total',
} as const
