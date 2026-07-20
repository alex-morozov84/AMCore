import { z } from 'zod'

const REALTIME_NAMESPACE = z
  .string()
  .max(64)
  .regex(/^[a-z0-9:_-]*$/, 'lowercase alphanumerics, ":", "_" and "-" only')
  .default('')

// Realtime notification transport (ADR-053, Track B Arc C): SSE + Redis Pub/Sub
// fan-out. NAMESPACE composes into the channel so staging != prod on a shared Redis
// (NODE_ENV alone can't distinguish them); web and worker MUST resolve the same
// value. The remaining knobs bound per-process/per-connection resource use — see
// docs/notifications/README.md + observability.md.
export const notificationsRealtimeEnv = z.object({
  NOTIFICATIONS_REALTIME_NAMESPACE: REALTIME_NAMESPACE,
  NOTIFICATIONS_REALTIME_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  NOTIFICATIONS_REALTIME_MAX_PER_USER: z.coerce.number().int().min(1).max(100).default(5),
  NOTIFICATIONS_REALTIME_MAX_CONNECTIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000000)
    .default(10000),
  NOTIFICATIONS_REALTIME_QUEUE_DEPTH: z.coerce.number().int().min(1).max(1000).default(16),
  NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86400000)
    .default(3600000),
  NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1)
    .max(30000)
    .default(1000),
  NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1000),
})

// Realtime AI run-status transport (Track C — ADR-054, Arc C.5): status-only SSE +
// Redis Pub/Sub fan-out, an AI-scoped copy of the ADR-053 primitives. NAMESPACE
// composes into the channel so staging != prod on a shared Redis; web (subscriber)
// and worker (publisher) MUST resolve the same value.
export const aiRealtimeEnv = z.object({
  AI_REALTIME_NAMESPACE: REALTIME_NAMESPACE,
  AI_REALTIME_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  AI_REALTIME_MAX_PER_USER: z.coerce.number().int().min(1).max(100).default(5),
  AI_REALTIME_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(1000000).default(10000),
  AI_REALTIME_QUEUE_DEPTH: z.coerce.number().int().min(1).max(1000).default(16),
  AI_REALTIME_MAX_STREAM_LIFETIME_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86400000)
    .default(3600000),
  AI_REALTIME_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(1).max(30000).default(1000),
  AI_REALTIME_MAX_INFLIGHT_PUBLISH: z.coerce.number().int().min(1).max(100000).default(1000),
})
