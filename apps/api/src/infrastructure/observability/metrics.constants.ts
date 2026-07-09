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
  cacheOperationsTotal: 'amcore_cache_operations_total',
  storageOperationsTotal: 'amcore_storage_operations_total',
  storageOperationDurationSeconds: 'amcore_storage_operation_duration_seconds',
  mediaOperationsTotal: 'amcore_media_operations_total',
  mediaOperationDurationSeconds: 'amcore_media_operation_duration_seconds',
  emailOperationsTotal: 'amcore_email_operations_total',
  emailOperationDurationSeconds: 'amcore_email_operation_duration_seconds',
  emailDeadLettersTotal: 'amcore_email_dead_letters_total',
  notificationRealtimePublishTotal: 'amcore_notification_realtime_publish_total',
  notificationRealtimeConnections: 'amcore_notification_realtime_connections',
  notificationRealtimeEventsTotal: 'amcore_notification_realtime_events_total',
  aiGenerationsTotal: 'amcore_ai_generations_total',
  aiTokensTotal: 'amcore_ai_tokens_total',
  aiGuardrailChecksTotal: 'amcore_ai_guardrail_checks_total',
  aiRunRealtimePublishTotal: 'amcore_ai_run_realtime_publish_total',
  aiRunRealtimeConnections: 'amcore_ai_run_realtime_connections',
  aiRunRealtimeEventsTotal: 'amcore_ai_run_realtime_events_total',
} as const
