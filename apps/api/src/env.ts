import { z } from 'zod'

const optionalEnvString = (): z.ZodPipe<
  z.ZodTransform<unknown, unknown>,
  z.ZodOptional<z.ZodString>
> =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional()
  )

const optionalEnvUrl = (): z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodOptional<z.ZodURL>> =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.url().optional()
  )

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DATABASE_POOL_IDLE_MS: z.coerce.number().int().min(0).default(30000),
    DATABASE_CONNECT_MS: z.coerce.number().int().min(0).default(5000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
    DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
    DATABASE_POOL_WAITING_THRESHOLD: z.coerce.number().int().min(0).default(5),
    SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().min(0).optional(),
    LOG_BODY_MAX_BYTES: z.coerce.number().int().min(0).default(4096),
    HEALTH_DISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.9),
    REDIS_URL: z.url(),
    // Bull Board queue dashboard. Disabled in production unless explicitly
    // enabled (EQS-01: zero default attack surface). In non-production it is
    // mounted but still protected by SUPER_ADMIN cookie auth. Enum-transform
    // rather than z.coerce.boolean() — the latter treats the string 'false'
    // as true.
    //
    // NOTE: the mount gate in queue.module.ts reads this from `process.env` at
    // module-import time, BEFORE ConfigModule loads the .env file. This schema
    // entry validates/types the flag for app code, but to enable the dashboard
    // in production you must set ENABLE_BULL_BOARD as a real process env var,
    // not via the .env file. See `.env.example` and `bull-board-mount-gate.ts`.
    ENABLE_BULL_BOARD: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION: z.string().default('7d'),
    JWT_REFRESH_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    // OB-06b / ADR-037: step-up recent-auth window (seconds). Destructive admin
    // ops require the session to have been (re)authenticated within this window.
    STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(1).default(600),
    RBAC_ACLV_CACHE_TTL_MS: z.coerce.number().int().min(0).default(0),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(5002),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:3002')
      .transform((s) => s.split(',').map((x) => x.trim())),
    GOOGLE_CLIENT_ID: optionalEnvString(),
    GOOGLE_CLIENT_SECRET: optionalEnvString(),
    GOOGLE_CALLBACK_URL: optionalEnvUrl(),
    GITHUB_CLIENT_ID: optionalEnvString(),
    GITHUB_CLIENT_SECRET: optionalEnvString(),
    GITHUB_CALLBACK_URL: optionalEnvUrl(),
    APPLE_CLIENT_ID: optionalEnvString(),
    APPLE_TEAM_ID: optionalEnvString(),
    APPLE_KEY_ID: optionalEnvString(),
    APPLE_PRIVATE_KEY: optionalEnvString(),
    APPLE_CALLBACK_URL: optionalEnvUrl(),
    TELEGRAM_BOT_TOKEN: optionalEnvString(),
    TELEGRAM_CALLBACK_URL: optionalEnvUrl(),
    // Email Service
    EMAIL_PROVIDER: z.enum(['resend', 'mock']).default('mock'),
    RESEND_API_KEY: optionalEnvString(),
    EMAIL_FROM: z.email().default('noreply@amcore.com'),
    SUPPORT_EMAIL: z.email().default('support@amcore.com'),
    // Frontend URLs (for email links)
    FRONTEND_URL: z.url().default('http://localhost:3002'),
    // Auth token expiration
    PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().int().min(1).default(15),
    EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().min(1).default(48),
    // ---------------------------------------------------------------------
    // Storage (cloud-agnostic file storage — see ai/STORAGE_PLAN.md)
    // ---------------------------------------------------------------------
    // Driver default is environment-derived (production -> s3, test -> memory,
    // otherwise local); resolved in the transform below so an unset value is
    // never `undefined`.
    STORAGE_DRIVER: z.enum(['s3', 'local', 'memory']).optional(),
    // S3-compatible config (required when STORAGE_DRIVER=s3; endpoint stays
    // optional — AWS derives it, non-AWS providers set it explicitly).
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
  })
  .transform((env) => {
    // Locked invariant (Decision C): dev -> local, test -> memory,
    // production -> s3. Defaulting prod to s3 (not local) means a prod deploy
    // without storage config fails the s3 fail-fast below rather than silently
    // writing to local disk.
    const storageDriverDefault =
      env.NODE_ENV === 'production' ? 's3' : env.NODE_ENV === 'test' ? 'memory' : 'local'

    return {
      ...env,
      SLOW_QUERY_THRESHOLD_MS:
        env.SLOW_QUERY_THRESHOLD_MS ?? (env.NODE_ENV === 'production' ? 500 : 100),
      STORAGE_DRIVER: env.STORAGE_DRIVER ?? storageDriverDefault,
    }
  })
  .superRefine((env, ctx) => {
    const requireAllIfAny = (groupName: string, keys: Array<keyof typeof env>): void => {
      const hasAny = keys.some((key) => env[key] !== undefined)
      if (!hasAny) return

      for (const key of keys) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${String(key)} is required when configuring ${groupName}`,
          })
        }
      }
    }

    requireAllIfAny('Google OAuth', [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_CALLBACK_URL',
    ])
    requireAllIfAny('GitHub OAuth', [
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_CALLBACK_URL',
    ])
    requireAllIfAny('Apple OAuth', [
      'APPLE_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'APPLE_CALLBACK_URL',
    ])
    requireAllIfAny('Telegram OAuth', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CALLBACK_URL'])

    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is resend',
      })
    }

    // Storage: when the s3 driver is selected, credentials + target are
    // mandatory. STORAGE_ENDPOINT stays optional (AWS derives it; non-AWS
    // providers set it explicitly). STORAGE_REGION always has a default.
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of [
        'STORAGE_BUCKET',
        'STORAGE_ACCESS_KEY_ID',
        'STORAGE_SECRET_ACCESS_KEY',
        'STORAGE_REGION',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER is s3`,
          })
        }
      }
    }

    if (env.STORAGE_SIGNED_URL_DEFAULT_TTL > env.STORAGE_SIGNED_URL_MAX_TTL) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_SIGNED_URL_DEFAULT_TTL'],
        message: 'STORAGE_SIGNED_URL_DEFAULT_TTL must be <= STORAGE_SIGNED_URL_MAX_TTL',
      })
    }

    if (env.NODE_ENV === 'production') {
      let sslmode: string | null = null

      try {
        sslmode = new URL(env.DATABASE_URL).searchParams.get('sslmode')?.toLowerCase() ?? null
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must be a valid URL',
        })
        return
      }

      if (sslmode !== 'require' && sslmode !== 'verify-full') {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must include sslmode=require or sslmode=verify-full in production',
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export function validate(config: Record<string, unknown>): Env {
  return envSchema.parse(config) as Env
}
