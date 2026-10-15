import { z } from 'zod'

import { optionalEnvString, optionalEnvUrl } from './helpers'

// Cloud-agnostic file storage. The driver default is
// environment-derived (production → s3, test → memory, otherwise local) in the
// composed transform, and the composed refinement requires the s3 credentials when
// the s3 driver is selected.
export const storageEnv = z.object({
  STORAGE_DRIVER: z.enum(['s3', 'local', 'memory']).optional(),
  // S3-compatible config (required when STORAGE_DRIVER=s3; endpoint stays optional —
  // AWS derives it, non-AWS providers set it explicitly).
  STORAGE_ENDPOINT: optionalEnvUrl(),
  // Browser-facing S3 API origin used ONLY to presign URLs (default: STORAGE_ENDPOINT).
  // It must be a bare origin; the public/CDN base is STORAGE_PUBLIC_BASE_URL.
  STORAGE_PRESIGN_ENDPOINT: optionalEnvUrl(),
  // How `public/` objects become readable: `external` never sends an ACL (the operator
  // publishes the location); `acl` sends `public-read` per object on providers that enforce it;
  // `api` serves them through this API's public route with the application's own credentials,
  // so nothing needs to be public on the provider.
  STORAGE_PUBLIC_DELIVERY: z.enum(['external', 'acl', 'api']).default('external'),
  // Bucket for `public/` keys; defaults to STORAGE_BUCKET (one bucket, one public prefix).
  STORAGE_PUBLIC_BUCKET: optionalEnvString(),
  // Where a browser fetches public files: the root of the public bucket (CDN, custom or
  // provider public domain) for `external`/`acl`; the absolute URL of this API's public
  // route for `api` and for the local driver.
  STORAGE_PUBLIC_BASE_URL: optionalEnvUrl(),
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
  // Limits & signed-URL TTLs (seconds). Max TTL is the SigV4 7-day hard limit.
  STORAGE_MAX_FILE_SIZE: z.coerce.number().int().min(1).default(52428800),
  STORAGE_SIGNED_URL_DEFAULT_TTL: z.coerce.number().int().min(1).default(3600),
  STORAGE_SIGNED_URL_MAX_TTL: z.coerce.number().int().min(1).max(604800).default(604800),
  // Independent active file transaction; runs in API and worker, never per request.
  STORAGE_PROBE_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(600),
  STORAGE_PROBE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(20).default(10),
  STORAGE_PROBE_PREFIX: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default('__amcore_probes__'),
  // Public-delivery check (s3 only): reads, never writes, after one idempotent canary write
  // at boot. Environment-only; it does not join the runtime-setting machinery.
  STORAGE_PUBLIC_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  STORAGE_PUBLIC_CHECK_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(30).default(10),
  // Opt-in storage readiness check (Decision B): off by default.
  STORAGE_HEALTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Key the storage health probe HEADs. Override to a key inside the allowed prefix
  // when using object-scoped S3 credentials, so the probe isn't a false 403;
  // use an existing readable object: missing keys may return 403 without ListBucket.
  STORAGE_HEALTH_PROBE_KEY: z.string().min(1).default('__storage_health_check__'),
})
