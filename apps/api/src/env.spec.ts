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
