import { ZodError } from 'zod'

import { validate } from './env'

describe('env validation', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: '12345678901234567890123456789012',
    FRONTEND_URL: 'http://localhost:3002',
  }

  it('treats empty optional provider variables as disabled', () => {
    const env = validate({
      ...baseEnv,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_CALLBACK_URL: '',
      RESEND_API_KEY: '',
      WEBHOOK_STRIPE_SECRET: '',
    })

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined()
    expect(env.GOOGLE_CALLBACK_URL).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.WEBHOOK_SECRETS).toEqual({})
  })

  it('collects dynamic webhook secrets and defaults replay TTL to tolerance', () => {
    const env = validate({
      ...baseEnv,
      WEBHOOK_STRIPE_SECRET: 'whsec_stripe',
      WEBHOOK_GENERIC_SECRET: 'whsec_generic',
      WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: '120',
    })

    expect(env.WEBHOOK_SECRETS).toEqual({
      stripe: 'whsec_stripe',
      generic: 'whsec_generic',
    })
    expect(env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS).toBe(120)
    expect(env.WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS).toBe(120)
  })

  // The webhook secret grammar is validated within a full channel config (token + username),
  // so these isolate the grammar check from the channel-gating below.
  const telegramChannelBase = {
    TELEGRAM_BOT_TOKEN: '123456:bot-token',
    TELEGRAM_BOT_USERNAME: 'amcore_bot',
  }

  it('accepts a Telegram webhook secret in the official grammar', () => {
    const env = validate({
      ...baseEnv,
      ...telegramChannelBase,
      WEBHOOK_TELEGRAM_SECRET: 'aB0_-Zz9',
    })
    expect(env.WEBHOOK_SECRETS).toEqual({ telegram: 'aB0_-Zz9' })
  })

  it('rejects a Telegram webhook secret outside the A-Za-z0-9_- grammar', () => {
    expect(() =>
      validate({ ...baseEnv, ...telegramChannelBase, WEBHOOK_TELEGRAM_SECRET: 'bad secret!' })
    ).toThrow(ZodError)
  })

  it('rejects a Telegram webhook secret longer than 256 chars', () => {
    expect(() =>
      validate({ ...baseEnv, ...telegramChannelBase, WEBHOOK_TELEGRAM_SECRET: 'a'.repeat(257) })
    ).toThrow(ZodError)
  })

  it('applies idempotency defaults', () => {
    const env = validate(baseEnv)

    expect(env.IDEMPOTENCY_RETENTION_SECONDS).toBe(86400)
    expect(env.IDEMPOTENCY_LOCK_TTL_SECONDS).toBe(30)
    expect(env.IDEMPOTENCY_FAIL_MODE).toBe('open')
    expect(env.IDEMPOTENCY_REDIS_TIMEOUT_MS).toBe(100)
  })

  it('applies realtime notification defaults', () => {
    const env = validate(baseEnv)

    expect(env.NOTIFICATIONS_REALTIME_NAMESPACE).toBe('')
    expect(env.NOTIFICATIONS_REALTIME_HEARTBEAT_MS).toBe(20000)
    expect(env.NOTIFICATIONS_REALTIME_MAX_PER_USER).toBe(5)
    expect(env.NOTIFICATIONS_REALTIME_MAX_CONNECTIONS).toBe(10000)
    expect(env.NOTIFICATIONS_REALTIME_QUEUE_DEPTH).toBe(16)
    expect(env.NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS).toBe(3600000)
    expect(env.NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS).toBe(1000)
    expect(env.NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH).toBe(1000)
  })

  it('coerces realtime numeric overrides and accepts a namespace', () => {
    const env = validate({
      ...baseEnv,
      NOTIFICATIONS_REALTIME_NAMESPACE: 'staging',
      NOTIFICATIONS_REALTIME_HEARTBEAT_MS: '15000',
      NOTIFICATIONS_REALTIME_MAX_PER_USER: '3',
    })

    expect(env.NOTIFICATIONS_REALTIME_NAMESPACE).toBe('staging')
    expect(env.NOTIFICATIONS_REALTIME_HEARTBEAT_MS).toBe(15000)
    expect(env.NOTIFICATIONS_REALTIME_MAX_PER_USER).toBe(3)
  })

  it('rejects a realtime namespace with illegal characters', () => {
    expect(() =>
      validate({ ...baseEnv, NOTIFICATIONS_REALTIME_NAMESPACE: 'Staging Prod' })
    ).toThrow(ZodError)
  })

  it.each([
    ['NOTIFICATIONS_REALTIME_HEARTBEAT_MS', '999'],
    ['NOTIFICATIONS_REALTIME_HEARTBEAT_MS', '60001'],
    ['NOTIFICATIONS_REALTIME_MAX_PER_USER', '0'],
    ['NOTIFICATIONS_REALTIME_MAX_PER_USER', '101'],
    ['NOTIFICATIONS_REALTIME_MAX_CONNECTIONS', '0'],
    ['NOTIFICATIONS_REALTIME_MAX_CONNECTIONS', '1000001'],
    ['NOTIFICATIONS_REALTIME_QUEUE_DEPTH', '0'],
    ['NOTIFICATIONS_REALTIME_QUEUE_DEPTH', '1001'],
    ['NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS', '999'],
    ['NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS', '86400001'],
    ['NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS', '0'],
    ['NOTIFICATIONS_REALTIME_PUBLISH_TIMEOUT_MS', '30001'],
    ['NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH', '0'],
    ['NOTIFICATIONS_REALTIME_MAX_INFLIGHT_PUBLISH', '100001'],
  ])('rejects realtime %s=%s outside its range', (key, value) => {
    expect(() => validate({ ...baseEnv, [key]: value })).toThrow(ZodError)
  })

  it('applies realtime AI run defaults', () => {
    const env = validate(baseEnv)

    expect(env.AI_REALTIME_NAMESPACE).toBe('')
    expect(env.AI_REALTIME_HEARTBEAT_MS).toBe(20000)
    expect(env.AI_REALTIME_MAX_PER_USER).toBe(5)
    expect(env.AI_REALTIME_MAX_CONNECTIONS).toBe(10000)
    expect(env.AI_REALTIME_QUEUE_DEPTH).toBe(16)
    expect(env.AI_REALTIME_MAX_STREAM_LIFETIME_MS).toBe(3600000)
    expect(env.AI_REALTIME_PUBLISH_TIMEOUT_MS).toBe(1000)
    expect(env.AI_REALTIME_MAX_INFLIGHT_PUBLISH).toBe(1000)
  })

  it('rejects an AI realtime namespace with illegal characters', () => {
    expect(() => validate({ ...baseEnv, AI_REALTIME_NAMESPACE: 'Staging Prod' })).toThrow(ZodError)
  })

  it.each([
    ['AI_REALTIME_HEARTBEAT_MS', '999'],
    ['AI_REALTIME_HEARTBEAT_MS', '60001'],
    ['AI_REALTIME_MAX_PER_USER', '0'],
    ['AI_REALTIME_MAX_PER_USER', '101'],
    ['AI_REALTIME_MAX_CONNECTIONS', '0'],
    ['AI_REALTIME_MAX_CONNECTIONS', '1000001'],
    ['AI_REALTIME_QUEUE_DEPTH', '0'],
    ['AI_REALTIME_QUEUE_DEPTH', '1001'],
    ['AI_REALTIME_MAX_STREAM_LIFETIME_MS', '999'],
    ['AI_REALTIME_MAX_STREAM_LIFETIME_MS', '86400001'],
    ['AI_REALTIME_PUBLISH_TIMEOUT_MS', '0'],
    ['AI_REALTIME_PUBLISH_TIMEOUT_MS', '30001'],
    ['AI_REALTIME_MAX_INFLIGHT_PUBLISH', '0'],
    ['AI_REALTIME_MAX_INFLIGHT_PUBLISH', '100001'],
  ])('rejects AI realtime %s=%s outside its range', (key, value) => {
    expect(() => validate({ ...baseEnv, [key]: value })).toThrow(ZodError)
  })

  it('fails when an OAuth provider is only partially configured', () => {
    expect(() =>
      validate({
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'google-client-id',
      })
    ).toThrow(ZodError)
  })

  it('fails when resend is selected without an API key', () => {
    expect(() =>
      validate({
        ...baseEnv,
        EMAIL_PROVIDER: 'resend',
      })
    ).toThrow(ZodError)
  })

  it('accepts fully configured providers', () => {
    const env = validate({
      ...baseEnv,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3002/api/v1/auth/google/callback',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_key_123',
    })

    expect(env.GOOGLE_CLIENT_ID).toBe('google-client-id')
    expect(env.EMAIL_PROVIDER).toBe('resend')
    expect(env.RESEND_API_KEY).toBe('re_test_key_123')
  })

  describe('Telegram OAuth + notifications channel gating (Arc D)', () => {
    const TOKEN = '123456:bot-token'
    const USERNAME = 'amcore_bot'
    const SECRET = 'aB0_-Zz9'

    it('accepts no Telegram config at all', () => {
      expect(validate(baseEnv).TELEGRAM_BOT_TOKEN).toBeUndefined()
    })

    it('accepts the bot token alone (OAuth/token-only mode — no callback, no channel)', () => {
      const env = validate({ ...baseEnv, TELEGRAM_BOT_TOKEN: TOKEN })
      expect(env.TELEGRAM_BOT_TOKEN).toBe(TOKEN)
      expect(env.TELEGRAM_API_BASE_URL).toBe('https://api.telegram.org')
    })

    it('accepts the OAuth pair (token + callback)', () => {
      const env = validate({
        ...baseEnv,
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_CALLBACK_URL: 'https://app.example/auth/telegram/callback',
      })
      expect(env.TELEGRAM_CALLBACK_URL).toBe('https://app.example/auth/telegram/callback')
    })

    it('rejects a callback without a token', () => {
      expect(() =>
        validate({ ...baseEnv, TELEGRAM_CALLBACK_URL: 'https://app.example/cb' })
      ).toThrow(ZodError)
    })

    it('accepts the full notifications trio and normalizes a leading @ in the username', () => {
      const env = validate({
        ...baseEnv,
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_BOT_USERNAME: `@${USERNAME}`,
        WEBHOOK_TELEGRAM_SECRET: SECRET,
      })
      expect(env.TELEGRAM_BOT_USERNAME).toBe(USERNAME)
      expect(env.WEBHOOK_SECRETS).toEqual({ telegram: SECRET })
    })

    it('rejects the channel enabled by username but missing token/secret', () => {
      expect(() => validate({ ...baseEnv, TELEGRAM_BOT_USERNAME: USERNAME })).toThrow(ZodError)
    })

    it('rejects the channel enabled by secret but missing token/username', () => {
      expect(() => validate({ ...baseEnv, WEBHOOK_TELEGRAM_SECRET: SECRET })).toThrow(ZodError)
    })

    it('rejects the partial trio token+username (missing secret)', () => {
      expect(() =>
        validate({ ...baseEnv, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: USERNAME })
      ).toThrow(ZodError)
    })

    it('rejects the partial trio token+secret (missing username)', () => {
      expect(() =>
        validate({ ...baseEnv, TELEGRAM_BOT_TOKEN: TOKEN, WEBHOOK_TELEGRAM_SECRET: SECRET })
      ).toThrow(ZodError)
    })

    it('rejects the partial trio username+secret (missing token)', () => {
      expect(() =>
        validate({ ...baseEnv, TELEGRAM_BOT_USERNAME: USERNAME, WEBHOOK_TELEGRAM_SECRET: SECRET })
      ).toThrow(ZodError)
    })

    it('rejects a malformed bot username', () => {
      expect(() =>
        validate({
          ...baseEnv,
          TELEGRAM_BOT_TOKEN: TOKEN,
          TELEGRAM_BOT_USERNAME: 'no',
          WEBHOOK_TELEGRAM_SECRET: SECRET,
        })
      ).toThrow(ZodError)
    })

    it('accepts both features together (OAuth callback + notifications channel)', () => {
      const env = validate({
        ...baseEnv,
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_CALLBACK_URL: 'https://app.example/cb',
        TELEGRAM_BOT_USERNAME: USERNAME,
        WEBHOOK_TELEGRAM_SECRET: SECRET,
      })
      expect(env.TELEGRAM_BOT_USERNAME).toBe(USERNAME)
    })
  })

  it('leaves HEALTH_MEMORY_HEAP_BYTES unset by default and accepts a positive integer', () => {
    expect(validate(baseEnv).HEALTH_MEMORY_HEAP_BYTES).toBeUndefined()
    expect(
      validate({ ...baseEnv, HEALTH_MEMORY_HEAP_BYTES: '8589934592' }).HEALTH_MEMORY_HEAP_BYTES
    ).toBe(8589934592)
  })

  it('rejects a non-positive HEALTH_MEMORY_HEAP_BYTES', () => {
    expect(() => validate({ ...baseEnv, HEALTH_MEMORY_HEAP_BYTES: '0' })).toThrow(ZodError)
    expect(() => validate({ ...baseEnv, HEALTH_MEMORY_HEAP_BYTES: '-1' })).toThrow(ZodError)
  })

  it('applies database pool defaults', () => {
    const env = validate(baseEnv)

    expect(env.DATABASE_POOL_MAX).toBe(10)
    expect(env.DATABASE_POOL_IDLE_MS).toBe(30000)
    expect(env.DATABASE_CONNECT_MS).toBe(5000)
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30000)
    expect(env.DATABASE_QUERY_TIMEOUT_MS).toBe(30000)
    expect(env.SLOW_QUERY_THRESHOLD_MS).toBe(100)
    expect(env.HEALTH_DISK_THRESHOLD_PERCENT).toBe(0.9)
    expect(env.RBAC_ACLV_CACHE_TTL_MS).toBe(0)
  })

  it('applies production slow query threshold default', () => {
    const env = validate({
      ...baseEnv,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=require',
    })

    expect(env.SLOW_QUERY_THRESHOLD_MS).toBe(500)
  })

  it('accepts an explicit slow query threshold override', () => {
    const env = validate({
      ...baseEnv,
      SLOW_QUERY_THRESHOLD_MS: '750',
    })

    expect(env.SLOW_QUERY_THRESHOLD_MS).toBe(750)
  })

  it('accepts an explicit health disk threshold override', () => {
    const env = validate({
      ...baseEnv,
      HEALTH_DISK_THRESHOLD_PERCENT: '0.99',
    })

    expect(env.HEALTH_DISK_THRESHOLD_PERCENT).toBe(0.99)
  })

  it('fails in production when DATABASE_URL omits sslmode', () => {
    expect(() =>
      validate({
        ...baseEnv,
        NODE_ENV: 'production',
      })
    ).toThrow(ZodError)
  })

  it('accepts sslmode=require in production', () => {
    const env = validate({
      ...baseEnv,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=require',
    })

    expect(env.DATABASE_URL).toContain('sslmode=require')
  })

  it('accepts sslmode=verify-full in production', () => {
    const env = validate({
      ...baseEnv,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=verify-full',
    })

    expect(env.DATABASE_URL).toContain('sslmode=verify-full')
  })

  it('accepts uppercase sslmode in production', () => {
    const env = validate({
      ...baseEnv,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=REQUIRE',
    })

    expect(env.DATABASE_URL).toContain('sslmode=REQUIRE')
  })

  it('rejects sslmode=disable in production', () => {
    expect(() =>
      validate({
        ...baseEnv,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=disable',
      })
    ).toThrow(ZodError)
  })

  it('rejects sslmode=prefer in production', () => {
    expect(() =>
      validate({
        ...baseEnv,
        NODE_ENV: 'production',
        STORAGE_DRIVER: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=prefer',
      })
    ).toThrow(ZodError)
  })

  it('defaults the storage driver to memory in test and local in development', () => {
    expect(validate(baseEnv).STORAGE_DRIVER).toBe('local')
    expect(validate({ ...baseEnv, NODE_ENV: 'test' }).STORAGE_DRIVER).toBe('memory')
  })

  it('defaults the storage driver to s3 in production and requires its credentials', () => {
    expect(() =>
      validate({
        ...baseEnv,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=require',
      })
    ).toThrow(ZodError)
  })

  it('accepts a fully configured s3 storage driver in production', () => {
    const env = validate({
      ...baseEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/amcore?sslmode=require',
      STORAGE_BUCKET: 'amcore-prod',
      STORAGE_ACCESS_KEY_ID: 'AKIA_TEST',
      STORAGE_SECRET_ACCESS_KEY: 'secret-test',
    })

    expect(env.STORAGE_DRIVER).toBe('s3')
    expect(env.STORAGE_BUCKET).toBe('amcore-prod')
  })

  it('applies media processing defaults', () => {
    const env = validate(baseEnv)
    expect(env.MEDIA_MAX_PIXELS).toBe(40000000)
    expect(env.MEDIA_AVATAR_MAX_PIXELS).toBe(8000000)
    expect(env.MEDIA_AVATAR_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
  })

  it('rejects MEDIA_AVATAR_MAX_PIXELS greater than MEDIA_MAX_PIXELS', () => {
    expect(() =>
      validate({ ...baseEnv, MEDIA_MAX_PIXELS: '1000', MEDIA_AVATAR_MAX_PIXELS: '2000' })
    ).toThrow(ZodError)
  })

  it('rejects MEDIA_SHARP_LIMIT_INPUT_PIXELS greater than MEDIA_MAX_PIXELS', () => {
    expect(() =>
      validate({ ...baseEnv, MEDIA_MAX_PIXELS: '1000', MEDIA_SHARP_LIMIT_INPUT_PIXELS: '2000' })
    ).toThrow(ZodError)
  })
})
