import { createHash } from 'node:crypto'

import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Redis } from 'ioredis'

import { AuthErrorCode, SupportMailErrorCode } from '@amcore/shared'

import { AuthMailLimiter } from '../src/core/auth/auth-mail-limiter.service'
import { EnvService } from '../src/env/env.service'

import { e2eContainerLabels } from './e2e-owned-containers'
import { seedEnvelope } from './fixtures/counter-envelope'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const prefix = 'amcore:auth-mail:v1:'
const recipient = (email: string, kind = 'password_recovery'): string =>
  `${prefix}recipient:${kind}:${hash(email)}`
const actor = (id: string): string => `${prefix}actor:${hash(id)}`
const cooldown = (email: string): string => `${prefix}cooldown:password_recovery:${hash(email)}`

describe('Shared auth mail limits and legacy envelope counter import', () => {
  let broker: StartedRedisContainer
  let client: ReturnType<typeof createClient>
  // The legacy counter is seeded as the envelope the auth-mail script imports (see the fixture).
  const cache = {
    set: (key: string, value: number, ttl: number) => seedEnvelope(client, key, value, ttl),
  }
  let limiter: AuthMailLimiter

  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    client = createClient({ url: broker.getConnectionUrl(), RESP: 2 })
    await client.connect()
    limiter = new AuthMailLimiter(
      new EnvService(new ConfigService({ REDIS_URL: broker.getConnectionUrl() }))
    )
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    await client.flushDb()
  })
  afterAll(async () => {
    if (client?.isOpen) await client.quit()
    await broker?.stop()
  }, 60000)

  it.each([
    ['password_recovery', 'forgot'],
    ['email_verification', 'resend-verification'],
  ] as const)(
    'imports the actual %s legacy key, envelope and remaining TTL without a second budget',
    async (kind, legacy) => {
      const email = 'legacy@e2e.amcore.test'
      const logical = `rate:${legacy}:${email}`
      await cache.set(logical, 3, 240000)
      const physical = await client.keys('*')
      expect(physical).toEqual([logical])
      expect(JSON.parse((await client.get(physical[0]!))!)).toEqual({
        value: 3,
        expires: expect.any(Number),
      })
      const before = await client.pTTL(logical)
      await expect(limiter.reserve(email, kind)).rejects.toMatchObject({
        errorCode: AuthErrorCode.RATE_LIMIT_EXCEEDED,
      })
      expect(await client.get(recipient(email, kind))).toBe('3')
      const ttl = await client.pTTL(recipient(email, kind))
      expect(ttl).toBeGreaterThan(before - 1000)
      expect(ttl).toBeLessThanOrEqual(before)
      await client.del(logical)
      await expect(limiter.reserve(email, kind)).rejects.toMatchObject({
        errorCode: AuthErrorCode.RATE_LIMIT_EXCEEDED,
      })
    }
  )

  it('renews the admitted recipient TTL but never extends a refused request', async () => {
    const email = 'renew@e2e.amcore.test'
    await cache.set(`rate:forgot:${email}`, 1, 120000)
    await limiter.reserve(email, 'password_recovery')
    expect(await client.get(recipient(email))).toBe('2')
    expect(await client.pTTL(recipient(email))).toBeGreaterThan(3599000)
    await limiter.reserve(email, 'password_recovery')
    await client.pExpire(recipient(email), 90000)
    await expect(limiter.reserve(email, 'password_recovery')).rejects.toMatchObject({
      errorCode: AuthErrorCode.RATE_LIMIT_EXCEEDED,
    })
    expect(await client.pTTL(recipient(email))).toBeLessThanOrEqual(90000)
  })

  it('enforces one cooldown across operators and leaves other budgets unchanged on refusal', async () => {
    const email = 'cooldown@e2e.amcore.test'
    await limiter.reserve(email, 'password_recovery', 'one')
    const before = await client.pTTL(cooldown(email))
    await expect(limiter.reserve(email, 'password_recovery', 'two')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_LIMIT,
    })
    expect(await client.get(recipient(email))).toBe('1')
    expect(await client.get(actor('two'))).toBeNull()
    expect(await client.pTTL(cooldown(email))).toBeLessThanOrEqual(before)
    expect(await limiter.status(email, 'password_recovery', 'two')).toMatchObject({
      reason: 'cooldown',
    })
    await client.del(cooldown(email))
    await limiter.reserve(email, 'password_recovery', 'two')
    expect(await client.get(recipient(email))).toBe('2')
  })

  it('atomically admits only three simultaneous public requests', async () => {
    const email = 'concurrent@e2e.amcore.test'
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => limiter.reserve(email, 'password_recovery'))
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(await client.get(recipient(email))).toBe('3')
    await limiter.reserve(email, 'email_verification')
    expect(await client.get(recipient(email, 'email_verification'))).toBe('1')
  })

  it('keeps a real committed reservation when its reply is lost and never retries it', async () => {
    const email = 'lost-reply@e2e.amcore.test'
    const original = Redis.prototype.eval
    const evaluation = jest.spyOn(Redis.prototype, 'eval').mockImplementationOnce(async function (
      this: Redis,
      ...args: Parameters<Redis['eval']>
    ) {
      await original.apply(this, args)
      throw new Error('reply lost after Redis committed')
    })
    await expect(limiter.reserve(email, 'password_recovery', 'operator')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
    })
    expect(evaluation).toHaveBeenCalledTimes(1)
    expect(await client.get(recipient(email))).toBe('1')
    expect(await client.get(actor('operator'))).toBe('1')
    expect(await client.pTTL(cooldown(email))).toBeGreaterThan(0)
  })

  it('bounds actor requests across different recipients without consuming the refused recipient', async () => {
    for (let i = 0; i < 20; i++)
      await limiter.reserve(`actor-${i}@e2e.amcore.test`, 'password_recovery', 'operator')
    await expect(
      limiter.reserve('denied@e2e.amcore.test', 'password_recovery', 'operator')
    ).rejects.toMatchObject({ errorCode: SupportMailErrorCode.SUPPORT_MAIL_LIMIT })
    expect(await client.get(recipient('denied@e2e.amcore.test'))).toBeNull()
    expect(await client.get(actor('operator'))).toBe('20')
  })

  it.each([
    'not-json',
    '{"value":3}',
    '{"value":"3","expires":1000}',
    '{"value":4,"expires":1000}',
  ])('fails closed on malformed legacy data %s', async (raw) => {
    const email = 'malformed@e2e.amcore.test'
    await cache.set(`rate:forgot:${email}`, 1, 60000)
    const [key] = await client.keys('*')
    await client.set(key!, raw, { PX: 60000 })
    await expect(limiter.reserve(email, 'password_recovery')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
    })
    expect(await client.get(recipient(email))).toBeNull()
  })

  it('admits after legacy expiry and keeps prepare count on a fixed one-minute window', async () => {
    const email = 'expired@e2e.amcore.test'
    await cache.set(`rate:forgot:${email}`, 3, 60000)
    const [key] = await client.keys('*')
    await client.pExpire(key!, 0)
    await limiter.reserve(email, 'password_recovery')
    const prep = `${prefix}prepare:${hash('operator')}`
    await limiter.prepare('operator')
    await client.pExpire(prep, 40000)
    for (let i = 1; i < 20; i++) await limiter.prepare('operator')
    await expect(limiter.prepare('operator')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_LIMIT,
    })
    expect(await client.pTTL(prep)).toBeLessThanOrEqual(40000)
    expect(await client.get(prep)).toBe('20')
  })
})
