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
    })

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined()
    expect(env.GOOGLE_CALLBACK_URL).toBeUndefined()
    expect(env.RESEND_API_KEY).toBeUndefined()
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
})
