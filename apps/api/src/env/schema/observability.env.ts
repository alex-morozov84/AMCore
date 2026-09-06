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
  // Surfaced on the amcore_build_info info-metric. Unset locally; a deployer
  // sets these at build/deploy time (e.g. from the release tag and
  // $GITHUB_SHA). 'unknown' is an honest default, not a placeholder to fix
  // later — `|| 'unknown'` (not just `.default(...)`) so an accidentally
  // present-but-empty `APP_VERSION=` in an env file still resolves to it,
  // rather than a blank label value.
  APP_VERSION: z
    .string()
    .default('unknown')
    .transform((v) => v || 'unknown'),
  APP_COMMIT: z
    .string()
    .default('unknown')
    .transform((v) => v || 'unknown'),
  HEALTH_DISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.9),
  // Optional override of the liveness/readiness heap ceiling (bytes). Unset → the
  // hardcoded production defaults. The e2e harness sets it high because a single
  // `jest --runInBand` process accumulates every suite's heap (a test artifact, not
  // a production signal).
  HEALTH_MEMORY_HEAP_BYTES: z.coerce.number().int().min(1).optional(),
})
