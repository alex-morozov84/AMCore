import { validate } from './env'

// Behavior-fingerprint corpus for the env-schema modularization (PR 3-1). These
// snapshots capture the *whole-schema* resolved output (every applied default and
// derived value) and the normalized failure issues across representative envs.
// The section split is behavior-preserving iff these snapshots stay unchanged.
// Companion to env.spec.ts (which documents intent at the individual-case level).
//
// Secret-bearing values are redacted so no secrets are committed; the point of the
// success snapshots is the resolved *defaults*, not the provided secret values.

const SECRET_KEYS = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'RESEND_API_KEY',
  'METRICS_AUTH_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'APPLE_PRIVATE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'YANDEX_API_KEY',
  'AI_OPENAI_COMPATIBLE_API_KEY',
])

function redact(result: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(result).sort()) {
    const value = result[key]
    if (key === 'WEBHOOK_SECRETS' && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((name) => [name, '[redacted]'])
      )
    } else {
      out[key] = SECRET_KEYS.has(key) ? '[redacted]' : value
    }
  }
  return out
}

function issuesOf(config: Record<string, unknown>): Array<Record<string, unknown>> {
  try {
    validate(config)
    throw new Error('expected validate() to throw, but it succeeded')
  } catch (error) {
    const issues = (
      error as { issues?: Array<{ path: PropertyKey[]; code: string; message: string }> }
    ).issues
    if (!issues) throw error
    return issues
      .map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
      .sort((a, b) =>
        `${a.path}|${a.code}|${a.message}`.localeCompare(`${b.path}|${b.code}|${b.message}`)
      )
  }
}

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-of-at-least-32-characters',
}
const PROD_DB = 'postgresql://user:pass@db:5432/app?sslmode=require'

describe('env schema fingerprint (behavior-preservation corpus)', () => {
  describe('success — resolved output (defaults applied, secrets redacted)', () => {
    it('development (minimal)', () => {
      expect(redact(validate({ ...REQUIRED }))).toMatchSnapshot()
    })
    it('test env', () => {
      expect(redact(validate({ ...REQUIRED, NODE_ENV: 'test' }))).toMatchSnapshot()
    })
    it('production with local storage', () => {
      expect(
        redact(
          validate({
            ...REQUIRED,
            NODE_ENV: 'production',
            DATABASE_URL: PROD_DB,
            STORAGE_DRIVER: 'local',
          })
        )
      ).toMatchSnapshot()
    })
    it('production with s3 storage', () => {
      expect(
        redact(
          validate({
            ...REQUIRED,
            NODE_ENV: 'production',
            DATABASE_URL: PROD_DB,
            STORAGE_DRIVER: 's3',
            STORAGE_BUCKET: 'my-bucket',
            STORAGE_ACCESS_KEY_ID: 'akid',
            STORAGE_SECRET_ACCESS_KEY: 'secret',
            STORAGE_REGION: 'us-east-1',
          })
        )
      ).toMatchSnapshot()
    })
    it('dynamic webhook secrets (non-telegram)', () => {
      expect(
        redact(
          validate({
            ...REQUIRED,
            WEBHOOK_STRIPE_SECRET: 'whsec_x',
            WEBHOOK_GITHUB_SECRET: 'ghs_y',
          })
        )
      ).toMatchSnapshot()
    })
  })

  describe('failure — normalized issues (path + code + message)', () => {
    it('empty env', () => {
      expect(issuesOf({})).toMatchSnapshot()
    })
    it('partial Google OAuth', () => {
      expect(issuesOf({ ...REQUIRED, GOOGLE_CLIENT_ID: 'id' })).toMatchSnapshot()
    })
    it('Telegram channel enabled by username only', () => {
      expect(issuesOf({ ...REQUIRED, TELEGRAM_BOT_USERNAME: 'mybot' })).toMatchSnapshot()
    })
    it('resend without an API key', () => {
      expect(issuesOf({ ...REQUIRED, EMAIL_PROVIDER: 'resend' })).toMatchSnapshot()
    })
    it('production s3 without credentials', () => {
      expect(
        issuesOf({
          ...REQUIRED,
          NODE_ENV: 'production',
          DATABASE_URL: PROD_DB,
          STORAGE_DRIVER: 's3',
        })
      ).toMatchSnapshot()
    })
  })
})
