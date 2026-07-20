import { z } from 'zod'

import { optionalEnvString, optionalEnvUrl } from './helpers'

// Cloud-agnostic file storage (see ai/STORAGE_PLAN.md). The driver default is
// environment-derived (production → s3, test → memory, otherwise local) in the
// composed transform, and the composed refinement requires the s3 credentials when
// the s3 driver is selected.
export const storageEnv = z.object({
  STORAGE_DRIVER: z.enum(['s3', 'local', 'memory']).optional(),
  // S3-compatible config (required when STORAGE_DRIVER=s3; endpoint stays optional —
  // AWS derives it, non-AWS providers set it explicitly).
  STORAGE_ENDPOINT: optionalEnvUrl(),
  STORAGE_PUBLIC_ENDPOINT: optionalEnvUrl(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: optionalEnvString(),
  STORAGE_ACCESS_KEY_ID: optionalEnvString(),
  STORAGE_SECRET_ACCESS_KEY: optionalEnvString(),
  STORAGE_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Local driver config.
  STORAGE_LOCAL_ROOT: z.string().min(1).default('./uploads'),
  STORAGE_LOCAL_PUBLIC_BASE_URL: optionalEnvUrl(),
  // Limits & signed-URL TTLs (seconds). Max TTL is the SigV4 7-day hard limit.
  STORAGE_MAX_FILE_SIZE: z.coerce.number().int().min(1).default(52428800),
  STORAGE_SIGNED_URL_DEFAULT_TTL: z.coerce.number().int().min(1).default(3600),
  STORAGE_SIGNED_URL_MAX_TTL: z.coerce.number().int().min(1).max(604800).default(604800),
  // Opt-in storage readiness check (Decision B): off by default.
  STORAGE_HEALTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Key the storage health probe HEADs. Override to a key inside the allowed prefix
  // when using object-scoped S3 credentials, so the probe isn't a false 403. Never
  // needs to exist (a 404 still proves connectivity).
  STORAGE_HEALTH_PROBE_KEY: z.string().min(1).default('__storage_health_check__'),
})
