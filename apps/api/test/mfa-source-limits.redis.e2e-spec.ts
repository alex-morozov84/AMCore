import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { mfaHash } from '../src/core/auth/mfa/mfa-secrets.js'
import { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { MFA_SOURCE_LIMIT_SCRIPT } from '../src/core/auth/mfa/mfa-source-limits.lua.js'
import { EnvService } from '../src/env/env.service.js'

import { cleanupE2E } from './e2e-cleanup.js'
import { e2eContainerLabels } from './e2e-owned-containers.js'

describe('Shared atomic MFA source budgets on isolated Redis', () => {
  let broker: StartedRedisContainer
  let client: ReturnType<typeof createClient>
  let first: MfaSourceLimiterService
  let second: MfaSourceLimiterService
  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    client = createClient({ url: broker.getConnectionUrl() })
    await client.connect()
    const env = new EnvService(new ConfigService({ REDIS_URL: broker.getConnectionUrl() }))
    first = new MfaSourceLimiterService(env)
    second = new MfaSourceLimiterService(env)
  }, 120000)
  beforeEach(async () => {
    await client.flushDb()
  })
  afterAll(async () => {
    await cleanupE2E([
      { name: 'mfa-source-first', run: () => first?.onModuleDestroy(), milliseconds: 1000 },
      { name: 'mfa-source-second', run: () => second?.onModuleDestroy(), milliseconds: 1000 },
      {
        name: 'mfa-source-client',
        run: () => (client?.isOpen ? client.quit() : undefined),
        milliseconds: 5000,
      },
      {
        name: 'mfa-source-redis',
        run: () => broker?.stop({ timeout: 10000 }),
        milliseconds: 15000,
      },
    ])
  }, 60000)

  it.each([
    { kind: 'verify' as const, limit: 30 },
    { kind: 'start' as const, limit: 20 },
  ])('shares the strict $kind ceiling across replicas', async ({ kind, limit }) => {
    const results = await Promise.allSettled(
      Array.from({ length: limit + 1 }, (_, i) =>
        (i % 2 ? first : second).consume(kind, '203.0.113.9')
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(limit)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ status: 429 })
    const key = `rate:mfa_source:v1:${kind}:${mfaHash('203.0.113.9')}`
    expect(await client.zCard(key)).toBe(limit)
    const ttl = await client.pTTL(key)
    await expect(first.consume(kind, '203.0.113.9')).rejects.toMatchObject({ status: 429 })
    expect(await client.pTTL(key)).toBeLessThanOrEqual(ttl)
    await expect(first.consume(kind, '203.0.113.10')).resolves.toBeUndefined()
  })

  it('uses Redis time for expiry and does not erase future debt or malformed state', async () => {
    const key = 'controlled-mfa-window'
    const now = Date.now()
    await client.zAdd(
      key,
      Array.from({ length: 30 }, () => ({ score: now - 901_000, value: randomUUID() }))
    )
    await client.pExpire(key, 900_000)
    const run = () =>
      client.eval(MFA_SOURCE_LIMIT_SCRIPT, { keys: [key], arguments: [`verify:${randomUUID()}`] })
    expect(await run()).toEqual([1, 0])
    await client.del(key)
    await client.zAdd(
      key,
      Array.from({ length: 30 }, () => ({ score: now + 60_000, value: randomUUID() }))
    )
    await client.pExpire(key, 960_000)
    expect(await run()).toEqual([0, expect.any(Number)])
    expect(await client.zCard(key)).toBe(30)
    await client.del(key)
    await client.set(key, 'corrupt-state', { PX: 900_000 })
    expect(await run()).toEqual([-1, 0])
    expect(await client.get(key)).toBe('corrupt-state')
  })
})
