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

const envSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw
    return {
      ...raw,
      WEBHOOK_SECRETS: collectWebhookSecrets(raw as Record<string, unknown>),
    }
  },
  z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      // Process role (ADR-041): `web` serves HTTP + enqueues; `worker` runs BullMQ
      // processors + cron with health-only HTTP; `all` is both (dev/single-node).
      // The bootstrap reads this raw to pick the root module; this validates it.
      PROCESS_ROLE: z.enum(['web', 'worker', 'all']).default('all'),
      DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
      // Worker concurrency for BullMQ processors (ADR-041). Default 1 (BullMQ's
      // default); tune from ~floor(cpu/2) for I/O-bound jobs.
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(1),
      DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
      DATABASE_POOL_IDLE_MS: z.coerce.number().int().min(0).default(30000),
      DATABASE_CONNECT_MS: z.coerce.number().int().min(0).default(5000),
      DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
      DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
      DATABASE_POOL_WAITING_THRESHOLD: z.coerce.number().int().min(0).default(5),
      SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().min(0).optional(),
      LOG_BODY_MAX_BYTES: z.coerce.number().int().min(0).default(4096),
      // Prometheus metrics endpoint (ADR-042). Enabled by default; protect with
      // METRICS_AUTH_TOKEN or block at ingress/network policy if exposed publicly.
      METRICS_ENABLED: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
      METRICS_AUTH_TOKEN: optionalEnvString(),
      HEALTH_DISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.9),
      REDIS_URL: z.url(),
      WEBHOOK_SECRETS: z.record(z.string(), z.string()).default({}),
      WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().min(1).default(300),
      WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS: z.coerce.number().int().min(1).optional(),
      IDEMPOTENCY_RETENTION_SECONDS: z.coerce.number().int().min(1).default(86400),
      IDEMPOTENCY_LOCK_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
      IDEMPOTENCY_FAIL_MODE: z.enum(['open', 'closed']).default('open'),
      IDEMPOTENCY_REDIS_TIMEOUT_MS: z.coerce.number().int().min(1).default(100),
      // Realtime notification transport (ADR-053, Track B Arc C): SSE + Redis
      // Pub/Sub fan-out. NAMESPACE composes into the channel so staging != prod on
      // a shared Redis (NODE_ENV alone can't distinguish them); web and worker MUST
      // resolve the same value. The remaining knobs bound per-process/per-connection
      // resource use — see docs/notifications/README.md + observability.md.
      NOTIFICATIONS_REALTIME_NAMESPACE: z
        .string()
        .max(64)
        .regex(/^[a-z0-9:_-]*$/, 'lowercase alphanumerics, ":", "_" and "-" only')
        .default(''),
      NOTIFICATIONS_REALTIME_HEARTBEAT_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(60000)
        .default(20000),
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
      // Bull Board read-only mode (ADR-047). Secure default `true`: the dashboard
      // renders read-only; set `false` only to allow write actions (retry /
      // promote / clean / remove jobs). Like ENABLE_BULL_BOARD, the queue module
      // reads this from `process.env` at import time, before ConfigModule.
      BULL_BOARD_READ_ONLY: z
        .enum(['true', 'false'])
        .default('true')
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
      // Key the storage health probe HEADs. Override to a key inside the allowed
      // prefix when using object-scoped S3 credentials, so the probe isn't a
      // false 403. Never needs to exist (a 404 still proves connectivity).
      STORAGE_HEALTH_PROBE_KEY: z.string().min(1).default('__storage_health_check__'),
      // ---------------------------------------------------------------------
      // Media processing (image derivatives — see ai/MEDIA_PROCESSING_PLAN.md)
      // ---------------------------------------------------------------------
      // Decode-safety limits applied before/around sharp. Source bytes are capped
      // before download; decoded dimensions/pixels are validated after metadata.
      // `MEDIA_SHARP_LIMIT_INPUT_PIXELS` is the hard libvips decode guard
      // (defense-in-depth, not the only check).
      MEDIA_MAX_SOURCE_BYTES: z.coerce.number().int().min(1).default(5242880),
      MEDIA_MAX_WIDTH: z.coerce.number().int().min(1).default(8000),
      MEDIA_MAX_HEIGHT: z.coerce.number().int().min(1).default(8000),
      MEDIA_MAX_PIXELS: z.coerce.number().int().min(1).default(40000000),
      MEDIA_SHARP_LIMIT_INPUT_PIXELS: z.coerce.number().int().min(1).default(40000000),
      // Tighter pixel cap for the synchronous avatar path (F12): an avatar tops out
      // at 512 px, so 8 MP bounds per-decode memory/CPU under upload bursts.
      MEDIA_AVATAR_MAX_PIXELS: z.coerce.number().int().min(1).default(8000000),
      // Cache-control for public avatar derivatives. Keys are per-upload versioned,
      // so immutable long-lived caching is safe (no stale-on-overwrite).
      MEDIA_AVATAR_CACHE_CONTROL: z.string().min(1).default('public, max-age=31536000, immutable'),
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
        WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS:
          env.WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS ?? env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
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

      // Media: per-preset and hard decode pixel caps must not exceed the global cap.
      if (env.MEDIA_AVATAR_MAX_PIXELS > env.MEDIA_MAX_PIXELS) {
        ctx.addIssue({
          code: 'custom',
          path: ['MEDIA_AVATAR_MAX_PIXELS'],
          message: 'MEDIA_AVATAR_MAX_PIXELS must be <= MEDIA_MAX_PIXELS',
        })
      }

      if (env.MEDIA_SHARP_LIMIT_INPUT_PIXELS > env.MEDIA_MAX_PIXELS) {
        ctx.addIssue({
          code: 'custom',
          path: ['MEDIA_SHARP_LIMIT_INPUT_PIXELS'],
          message: 'MEDIA_SHARP_LIMIT_INPUT_PIXELS must be <= MEDIA_MAX_PIXELS',
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
            message:
              'DATABASE_URL must include sslmode=require or sslmode=verify-full in production',
          })
        }
      }
    })
)

function collectWebhookSecrets(config: Record<string, unknown>): Record<string, string> {
  return Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
    const match = /^WEBHOOK_([A-Z0-9_]+)_SECRET$/.exec(key)
    if (!match || typeof value !== 'string' || value.trim() === '') return acc
    acc[match[1]!.toLowerCase()] = value
    return acc
  }, {})
}

export type Env = z.infer<typeof envSchema>

export function validate(config: Record<string, unknown>): Env {
  return envSchema.parse(config) as Env
}
