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
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION: z.string().default('7d'),
    JWT_REFRESH_DAYS: z.coerce.number().int().min(1).max(365).default(7),
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
    FRONTEND_URL: z.string().url().default('http://localhost:3002'),
    // Auth token expiration
    PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().int().min(1).default(15),
    EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().min(1).default(48),
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
  })

export type Env = z.infer<typeof envSchema>

export function validate(config: Record<string, unknown>): Env {
  return envSchema.parse(config) as Env
}
