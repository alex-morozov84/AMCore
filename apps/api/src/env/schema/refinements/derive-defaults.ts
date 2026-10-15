import type { EnvInput } from '../base.js'

// The resolved env after cross-field defaults: the three env-derived fields are no
// longer optional. Declared explicitly (not `ReturnType<...>`) so the transform has
// an explicit return type and the rule modules can consume it.
export type EnvResolved = Omit<
  EnvInput,
  'SLOW_QUERY_THRESHOLD_MS' | 'STORAGE_DRIVER' | 'WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS'
> & {
  SLOW_QUERY_THRESHOLD_MS: number
  STORAGE_DRIVER: 's3' | 'local' | 'memory'
  WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS: number
}

/** `<global prefix>/storage/public`: the local public route (`StoragePublicController`). */
export const LOCAL_PUBLIC_ROUTE_PATH = '/api/v1/storage/public'

// Environment-derived defaults that depend on other fields (so they can't be a
// per-field `.default()`). Locked invariant (Decision C): dev → local, test →
// memory, production → s3. Defaulting prod to s3 (not local) means a prod deploy
// without storage config fails the s3 fail-fast rule rather than silently writing
// to local disk.
export function deriveConditionalDefaults(env: EnvInput): EnvResolved {
  const storageDriverDefault =
    env.NODE_ENV === 'production' ? 's3' : env.NODE_ENV === 'test' ? 'memory' : 'local'
  const storageDriver = env.STORAGE_DRIVER ?? storageDriverDefault

  return {
    ...env,
    SLOW_QUERY_THRESHOLD_MS:
      env.SLOW_QUERY_THRESHOLD_MS ?? (env.NODE_ENV === 'production' ? 500 : 100),
    STORAGE_DRIVER: storageDriver,
    // Zero-config development: the local driver is served by this API's own public route.
    // Production and every s3 deployment must set the base explicitly; nothing is guessed.
    STORAGE_PUBLIC_BASE_URL:
      env.STORAGE_PUBLIC_BASE_URL ??
      (storageDriver === 'local' && env.NODE_ENV !== 'production'
        ? `http://localhost:${env.API_PORT}${LOCAL_PUBLIC_ROUTE_PATH}`
        : undefined),
    WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS:
      env.WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS ?? env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  }
}
