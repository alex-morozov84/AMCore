import { z } from 'zod'

import {
  DEFAULT_TELEGRAM_API_BASE_URL,
  TELEGRAM_BOT_USERNAME_PATTERN,
  TELEGRAM_WEBHOOK_SECRET_PATTERN,
} from './core/notifications/channels/telegram/telegram.constants'

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

// A Telegram bot username (Arc D). Normalizes a leading `@` away and treats empty as unset;
// validates the public-username grammar (5–32 of A-Za-z0-9_). Used to build the `t.me/<name>`
// deep link and the `/start@<name>` command grammar.
const optionalTelegramUsername = (): z.ZodPipe<
  z.ZodTransform<unknown, unknown>,
  z.ZodOptional<z.ZodString>
> =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().replace(/^@/, '')
    return normalized === '' ? undefined : normalized
  }, z.string().regex(TELEGRAM_BOT_USERNAME_PATTERN, 'must be 5–32 chars of A-Za-z0-9_').optional())

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
      // Optional override of the liveness/readiness heap ceiling (bytes). Unset → the
      // hardcoded production defaults. The e2e harness sets it high because a single
      // `jest --runInBand` process accumulates every suite's heap (a test artifact, not
      // a production signal).
      HEALTH_MEMORY_HEAP_BYTES: z.coerce.number().int().min(1).optional(),
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
      // Realtime AI run-status transport (Track C — ADR-054, Arc C.5): status-only
      // SSE + Redis Pub/Sub fan-out, an AI-scoped copy of the ADR-053 primitives.
      // NAMESPACE composes into the channel so staging != prod on a shared Redis;
      // web (subscriber) and worker (publisher) MUST resolve the same value. The
      // remaining knobs bound per-process/per-connection resource use.
      AI_REALTIME_NAMESPACE: z
        .string()
        .max(64)
        .regex(/^[a-z0-9:_-]*$/, 'lowercase alphanumerics, ":", "_" and "-" only')
        .default(''),
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
      // Telegram notifications channel (Arc D). Username builds the deep link; the API base
      // URL is overridable for the fake-server e2e (default = the public Bot API).
      TELEGRAM_BOT_USERNAME: optionalTelegramUsername(),
      TELEGRAM_API_BASE_URL: z.url().default(DEFAULT_TELEGRAM_API_BASE_URL),
      // Public URL of the `/webhooks/telegram` endpoint, used only by the `telegram:setup`
      // deploy script's `setWebhook` call (not at runtime).
      TELEGRAM_WEBHOOK_URL: optionalEnvUrl(),
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
      // ---------------------------------------------------------------------
      // AI capability layer (Track C — ADR-054). The provider/model catalog is
      // DB-backed (admin-managed); only the SECRETS live in env. A catalog row's
      // `credentialSlot` is mapped to one of these fixed keys through a code-owned
      // per-type allowlist (`credential-resolver.ts`) — a slot value NEVER indexes
      // `process.env` directly. An enabled provider with no key is gated out at
      // runtime (the gateway falls back to the key-less `mock` provider), so these
      // stay optional with no `superRefine` force.
      ANTHROPIC_API_KEY: optionalEnvString(),
      OPENAI_API_KEY: optionalEnvString(),
      OPENROUTER_API_KEY: optionalEnvString(),
      YANDEX_API_KEY: optionalEnvString(),
      AI_OPENAI_COMPATIBLE_API_KEY: optionalEnvString(),
      // Per-request gateway bound (ms) applied to every provider call. Capped at 5 min so a
      // typo can't allow day-long calls (a long generation streams within this bound).
      AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).max(300000).default(60000),
      // Bounded Redis TTL for the catalog snapshot cache (seconds). Capped at 1h so an admin
      // catalog change can never stay stale longer than that even on a typo.
      AI_CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
      // Arc D input guardrail enforcement mode. `off` disables the heuristic input scan; `flag`
      // (default) records/counts findings but never blocks; `block` hard-blocks only AMCore
      // envelope/marker abuse. The structural trust boundary + output guard run regardless.
      AI_GUARDRAIL_INPUT_MODE: z.enum(['off', 'flag', 'block']).default('flag'),
      // Max characters of untrusted user text before a run is refused (guardrail_input_too_large).
      // Always enforced (independent of the input mode). Bounded so a typo can't disable the cap.
      AI_GUARDRAIL_MAX_INPUT_CHARS: z.coerce.number().int().min(1).max(1_000_000).default(100000),
      // Arc E bounded agent loop: max provider steps per run before tool_loop_exhausted. Bounded so
      // a runaway loop can never burn unlimited provider calls; total wall-clock is also capped by
      // the run deadline.
      AI_TOOL_LOOP_MAX_STEPS: z.coerce.number().int().min(1).max(50).default(8),
      // Arc E per-tool host-side execution bound (ms). Capped so a stuck tool cannot hold a loop
      // step open indefinitely.
      AI_TOOL_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(120000).default(15000),
      // Arc E human-in-the-loop approval TTL (ms): how long a run may sit parked in WAITING_APPROVAL
      // before the approval expires. Default 24h; bounded [1min, 30d] so a typo can neither expire a
      // pending approval instantly nor park a run indefinitely. A run's own deadline still wins if it
      // is tighter (the park stores min(now+TTL, deadlineAt)).
      AI_APPROVAL_TTL_MS: z.coerce
        .number()
        .int()
        .min(60_000)
        .max(2_592_000_000)
        .default(86_400_000),
      // Arc G artifact upload size ceilings (raw bytes, before base64 encoding). Defaults match the
      // existing IMAGE_VALIDATION/DOCUMENT_VALIDATION presets; bounded so a typo can neither starve
      // real uploads nor exceed verified provider per-request payload limits (Anthropic: 10 MB
      // base64/image, ~32 MB total request).
      AI_ARTIFACT_MAX_IMAGE_BYTES: z.coerce
        .number()
        .int()
        .min(1)
        .max(20_971_520)
        .default(5_242_880),
      AI_ARTIFACT_MAX_DOCUMENT_BYTES: z.coerce
        .number()
        .int()
        .min(1)
        .max(33_554_432)
        .default(10_485_760),
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
      // Telegram OAuth login and the notifications channel are INDEPENDENTLY optional but
      // share TELEGRAM_BOT_TOKEN. OAuth login: a callback URL requires a token, but a token
      // alone does NOT force a callback (token-only / channel-only is valid).
      if (env.TELEGRAM_CALLBACK_URL !== undefined && env.TELEGRAM_BOT_TOKEN === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_TOKEN'],
          message: 'TELEGRAM_BOT_TOKEN is required when TELEGRAM_CALLBACK_URL is set',
        })
      }

      // Telegram webhook secret grammar (Arc D): `setWebhook(secret_token=…)` is echoed in the
      // `X-Telegram-Bot-Api-Secret-Token` header. Validate the official grammar/length when
      // present so a malformed secret fails fast at config load, not at the first webhook.
      const telegramWebhookSecret = env.WEBHOOK_SECRETS.telegram
      if (
        telegramWebhookSecret !== undefined &&
        !TELEGRAM_WEBHOOK_SECRET_PATTERN.test(telegramWebhookSecret)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEBHOOK_SECRETS', 'telegram'],
          message: 'WEBHOOK_TELEGRAM_SECRET must be 1–256 characters of A-Za-z0-9_-',
        })
      }

      // Telegram notifications channel (Arc D, corr. F / R3): channel-gated, NOT a flat
      // requireAllIfAny over the token. The channel is *enabled* iff a channel-specific field
      // is present (bot username OR webhook secret); when enabled, require the full trio
      // (token + username + secret). So TELEGRAM_BOT_TOKEN alone stays valid (OAuth/token-only)
      // and never forces the channel fields.
      const telegramChannelEnabled =
        env.TELEGRAM_BOT_USERNAME !== undefined || telegramWebhookSecret !== undefined
      if (telegramChannelEnabled) {
        if (env.TELEGRAM_BOT_TOKEN === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['TELEGRAM_BOT_TOKEN'],
            message:
              'TELEGRAM_BOT_TOKEN is required when the Telegram notifications channel is enabled',
          })
        }
        if (env.TELEGRAM_BOT_USERNAME === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['TELEGRAM_BOT_USERNAME'],
            message:
              'TELEGRAM_BOT_USERNAME is required when the Telegram notifications channel is enabled',
          })
        }
        if (telegramWebhookSecret === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['WEBHOOK_SECRETS', 'telegram'],
            message:
              'WEBHOOK_TELEGRAM_SECRET is required when the Telegram notifications channel is enabled',
          })
        }
      }

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
