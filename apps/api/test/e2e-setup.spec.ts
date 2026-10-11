import { validate } from '../src/env/schema'

import { cleanupFailedE2ESetup, prepareE2EAuthEnvironment } from './e2e-setup'

describe('API e2e bootstrap prerequisites', () => {
  const originalSecret = process.env.JWT_SECRET

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalSecret
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
