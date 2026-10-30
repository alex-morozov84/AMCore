import { validate } from '../src/env/schema'

import { cleanupFailedE2ESetup, prepareE2EAuthEnvironment } from './e2e-setup'

describe('API e2e bootstrap prerequisites', () => {
  const keys = ['JWT_SECRET', 'MFA_ACTIVE_KEY_ID', 'MFA_ENCRYPTION_KEYS'] as const
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

  afterAll(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('supplies required auth config without an env file and replaces ambient secrets', () => {
    delete process.env.JWT_SECRET
    prepareE2EAuthEnvironment()
    const secret = process.env.JWT_SECRET
    const env = validate({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/amcore_test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_SECRET: secret,
    })
    expect(env.JWT_SECRET).toHaveLength(64)

    process.env.JWT_SECRET = 'ambient-owner-secret-never-use-in-tests'
    prepareE2EAuthEnvironment()
    expect(process.env.JWT_SECRET).toBe(secret)
    const keyring = process.env.MFA_ENCRYPTION_KEYS!
    expect(process.env.MFA_ACTIVE_KEY_ID).toBe('e2e-suite')
    expect(Buffer.from(JSON.parse(keyring)['e2e-suite'], 'base64')).toHaveLength(32)
    process.env.MFA_ENCRYPTION_KEYS = '{"ambient":"never-use-owner-keys"}'
    prepareE2EAuthEnvironment()
    expect(process.env.MFA_ENCRYPTION_KEYS).toBe(keyring)
  })

  it('still rejects application configuration without a JWT secret', () => {
    expect(() =>
      validate({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/amcore_test',
        REDIS_URL: 'redis://127.0.0.1:6379',
      })
    ).toThrow()
  })

  it('reports cleanup failure after attempting all later resources', async () => {
    const order: string[] = []
    await expect(
      cleanupFailedE2ESetup([
        async () => {
          order.push('app')
          throw new Error('close failed')
        },
        async () => {
          order.push('redis')
        },
        async () => {
          order.push('postgres')
        },
      ])
    ).rejects.toThrow('E2E cleanup failed')
    expect(order).toEqual(['app', 'redis', 'postgres'])
  })
})
