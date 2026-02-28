import { z } from 'zod'

const envSchema = z.object({
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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.url().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.url().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.url().optional(),
  // Email Service
  EMAIL_PROVIDER: z.enum(['resend', 'mock']).default('mock'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.email().default('noreply@amcore.com'),
  SUPPORT_EMAIL: z.email().default('support@amcore.com'),
  // Frontend URLs (for email links)
  FRONTEND_URL: z.string().url().default('http://localhost:3002'),
  // Auth token expiration
  PASSWORD_RESET_EXPIRY_MINUTES: z.coerce.number().int().min(1).default(15),
  EMAIL_VERIFICATION_EXPIRY_HOURS: z.coerce.number().int().min(1).default(48),
})

export type Env = z.infer<typeof envSchema>

export function validate(config: Record<string, unknown>): Env {
  return envSchema.parse(config) as Env
}
