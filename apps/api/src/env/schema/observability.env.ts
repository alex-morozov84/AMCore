import { z } from 'zod'

import { optionalEnvString } from './helpers'

// Logging, Prometheus metrics, and health-probe thresholds (ADR-042).
export const observabilityEnv = z.object({
  LOG_BODY_MAX_BYTES: z.coerce.number().int().min(0).default(4096),
  // Prometheus metrics endpoint (ADR-042). Enabled by default; protect with
  // METRICS_AUTH_TOKEN or block at ingress/network policy if exposed publicly.
  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  METRICS_AUTH_TOKEN: optionalEnvString(),
  HEALTH_DISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.9),
  // Optional override of the liveness/readiness heap ceiling (bytes). Unset → the
  // hardcoded production defaults. The e2e harness sets it high because a single
  // `jest --runInBand` process accumulates every suite's heap (a test artifact, not
  // a production signal).
  HEALTH_MEMORY_HEAP_BYTES: z.coerce.number().int().min(1).optional(),
})
